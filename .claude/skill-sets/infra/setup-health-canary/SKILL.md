---
description: Create a CloudWatch Synthetics canary that monitors a health endpoint and alarms on failure
argument-hint: "[aws-profile]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - Glob
  - AskUserQuestion
---

# Purpose

Set up a CloudWatch Synthetics canary that hits a service's `/health/ready` endpoint on a schedule, plus a CloudWatch alarm that fires when the canary fails. Depends on an SNS topic existing — run `/core:setup-alb-alarming` first.

No application code changes required. The canary runs as a Lambda function managed by AWS.

## Instructions

### 1. Determine AWS Profile

**If argument provided:**
- Use it as the AWS profile name (e.g., `dev`, `stage`, `prod`)

**If no argument:**
- Use AskUserQuestion:
  - Options: `dev`, `stage`, `prod`
  - Question: "Which AWS environment should we set up the health canary in?"

### 2. Verify AWS Session

```bash
aws sts get-caller-identity --profile {profile}
```

**If error (expired SSO):**
Report: "SSO session expired. Run `aws sso login --profile {profile}` and try again."
Stop.

**If success:**
Extract the account ID from the response. Store as `{account-id}`.

### 3. Verify SNS Topic Exists

```bash
aws sns list-topics --profile {profile} --query 'Topics[].TopicArn' --output text
```

Look for `survey-apps-{profile}-alerts` in the output.

**If not found:**
Report: "No SNS topic found. Run `/core:setup-alb-alarming {profile}` first to create the notification pipeline."
Stop.

**If found:**
Store the ARN as `{topic-arn}`.

### 4. Check for Existing Canary

```bash
aws synthetics describe-canaries --profile {profile} --query 'Canaries[].{Name:Name,State:Status.State}'
```

If a canary with the intended name already exists, report it and ask if the user wants to update or skip.

### 5. Gather Health Endpoint

Use AskUserQuestion:
- Question: "What health endpoint should the canary monitor?"
- Options based on profile:
  - `https://research-survey-management-api.dev.nrchealth.com/health/ready` (if dev)
  - `https://research-survey-management-api.stage.nrchealth.com/health/ready` (if stage)
  - `https://research-survey-management-api.nrchealth.com/health/ready` (if prod)
  - "Other" for custom URL

Also ask for a canary name:
- Question: "What should the canary be called? (max 21 characters)"
- Options: `mgmt-api-health` (Recommended), "Other"

Store the URL as `{health-url}` and the name as `{canary-name}`.

### 5b. Determine if VPC Config is Needed

Check if the health endpoint resolves to an internal ALB:

```bash
nslookup {hostname} 2>&1 || true
```

**If the CNAME contains `internal-`** (e.g., `internal-dev-nrc-*.elb.amazonaws.com`):
- The ALB is internal — the canary must run in-VPC.
- Identify the ALB's VPC and subnets:

```bash
aws elbv2 describe-load-balancers --profile {profile} \
  --query 'LoadBalancers[?contains(DNSName, `internal`)].{Name:LoadBalancerName,VpcId:VpcId,Subnets:AvailabilityZones[*].SubnetId,SGs:SecurityGroups}' --output json
```

- Store `{vpc-id}` and pick 2-3 subnets as `{subnet-ids}`.
- Create a security group for the canary:

```bash
aws ec2 create-security-group \
  --group-name "synthetics-canary-sg" \
  --description "Security group for CloudWatch Synthetics canary Lambda" \
  --vpc-id "{vpc-id}" \
  --profile {profile}
```

- Store the GroupId as `{canary-sg-id}`. Default outbound (all traffic) is sufficient.
- Set `{needs-vpc}` = true.

**If the ALB is internet-facing:** Set `{needs-vpc}` = false.

### 6. Create S3 Bucket for Artifacts

Check if the bucket already exists:

```bash
aws s3 ls s3://survey-apps-synthetics-{profile}-{account-id} 2>&1
```

**If bucket exists:** Skip creation.

**If not found:**

```bash
aws s3 mb s3://survey-apps-synthetics-{profile}-{account-id} --profile {profile}
```

### 7. Create IAM Role

Check if the role already exists:

```bash
aws iam get-role --role-name survey-apps-synthetics-canary-role --profile {profile} 2>&1
```

**If role exists:** Skip creation, use existing ARN.

**If not found:** Create the role and attach permissions.

#### 7a: Create the role

Write the trust policy to a temp file:

```bash
cat << 'TRUST' > /tmp/synthetics-trust-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
TRUST
```

```bash
aws iam create-role \
  --role-name survey-apps-synthetics-canary-role \
  --assume-role-policy-document file:///tmp/synthetics-trust-policy.json \
  --profile {profile}
```

Save the Role ARN as `{role-arn}`.

#### 7b: Attach the permissions policy

Write the permissions policy, replacing the S3 bucket name:

```bash
cat << PERMS > /tmp/synthetics-permissions.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Artifacts",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::survey-apps-synthetics-{profile}-{account-id}/*"
    },
    {
      "Sid": "S3BucketLocation",
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::survey-apps-synthetics-{profile}-{account-id}"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:CreateLogGroup", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:us-east-1:{account-id}:log-group:/aws/lambda/cwsyn-*"
    },
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": ["cloudwatch:PutMetricData"],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "CloudWatchSynthetics"
        }
      }
    },
    {
      "Sid": "VPCNetworking",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*"
    }
  ]
}
PERMS
```

```bash
aws iam put-role-policy \
  --role-name survey-apps-synthetics-canary-role \
  --policy-name synthetics-canary-permissions \
  --policy-document file:///tmp/synthetics-permissions.json \
  --profile {profile}
```

### 8. Write and Package the Canary Script

Parse the hostname and path from `{health-url}`.

Create the canary script:

```bash
mkdir -p /tmp/canary-script/nodejs/node_modules
```

Write the script (substitute `{health-url}`, `{hostname}`, and `{path}` from the URL):

```bash
cat << SCRIPT > /tmp/canary-script/nodejs/node_modules/apiCanaryBlueprint.js
const { URL } = require('url');
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const apiCanaryBlueprint = async function () {
  const url = '{health-url}';

  const requestOptions = {
    hostname: '{hostname}',
    method: 'GET',
    path: '{path}',
    port: 443,
    protocol: 'https:',
    headers: {
      'User-Agent': 'CloudWatchSynthetics'
    }
  };

  log.info('Checking health at: ' + url);

  const stepConfig = {
    includeRequestHeaders: true,
    includeResponseHeaders: true,
    includeRequestBody: false,
    includeResponseBody: true
  };

  await synthetics.executeHttpStep('healthCheck', requestOptions, validateResponse, stepConfig);
};

const validateResponse = async function (res) {
  log.info('Response status: ' + res.statusCode);

  if (res.statusCode !== 200) {
    throw new Error('Expected 200, got ' + res.statusCode);
  }

  // res.body may not be populated by executeHttpStep — read from stream if needed
  const body = await new Promise(function(resolve, reject) {
    if (typeof res.body === 'string') { resolve(res.body); return; }
    var data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() { resolve(data); });
    res.on('error', reject);
  });

  log.info('Response body: ' + body);
  var parsed = JSON.parse(body);

  // Case-insensitive status check (API returns "green" lowercase)
  var status = (parsed.status || '').toLowerCase();
  if (status && status !== 'green' && status !== 'healthy') {
    throw new Error('Health check returned unhealthy status: ' + parsed.status);
  }

  log.info('Health check passed');
};

exports.handler = async () => {
  return await apiCanaryBlueprint();
};
SCRIPT
```

Package it:

```bash
cd /tmp/canary-script && zip -r /tmp/canary-script.zip nodejs/
```

### 9. Create the Canary

**Important:** The ZipFile parameter requires base64-encoded content, NOT a file path.

```bash
ZIPFILE=$(base64 -i /tmp/canary-script.zip)

aws synthetics create-canary \
  --name "{canary-name}" \
  --artifact-s3-location "s3://survey-apps-synthetics-{profile}-{account-id}/canary-artifacts" \
  --execution-role-arn "{role-arn}" \
  --schedule '{"Expression":"rate(5 minutes)"}' \
  --runtime-version "syn-nodejs-puppeteer-14.0" \
  --code "{\"Handler\":\"apiCanaryBlueprint.handler\",\"ZipFile\":\"${ZIPFILE}\"}" \
  --run-config '{"TimeoutInSeconds":60}' \
  --success-retention-period-in-days 7 \
  --failure-retention-period-in-days 14 \
  ${VPC_CONFIG} \
  --profile {profile}
```

**VPC config:** If `{needs-vpc}` is true, set `VPC_CONFIG` to:
```bash
VPC_CONFIG='--vpc-config {"SubnetIds":["{subnet-1}","{subnet-2}","{subnet-3}"],"SecurityGroupIds":["{canary-sg-id}"]}'
```

If `{needs-vpc}` is false, set `VPC_CONFIG` to empty string.

> **Note:** VPC attachment takes 1-3 minutes for ENI provisioning. The canary will be in UPDATING state during this time.
```

### 10. Wait for Provisioning and Start

Poll until status is READY (check every 10 seconds, max 60 seconds):

```bash
aws synthetics get-canary --name "{canary-name}" --profile {profile} --query 'Canary.Status.State'
```

Once READY:

```bash
aws synthetics start-canary --name "{canary-name}" --profile {profile}
```

### 11. Verify First Run

Wait ~30 seconds for the first execution, then check:

```bash
aws synthetics get-canary-runs \
  --name "{canary-name}" \
  --profile {profile} \
  --query 'CanaryRuns[0].{Status:Status.State,Started:Timeline.Started,Completed:Timeline.Completed}'
```

**If PASSED:** Report success.

**If FAILED:** Check logs and report the error:

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/cwsyn-{canary-name}" \
  --profile {profile}
```

Use AskUserQuestion to ask if the user wants to debug or continue.

### 12. Create Alarm on Canary Failure

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "survey-management-api-{profile}-health-canary-failed" \
  --alarm-description "Synthetics canary for management-api health check failed in {profile}" \
  --namespace "CloudWatchSynthetics" \
  --metric-name "SuccessPercent" \
  --dimensions "Name=CanaryName,Value={canary-name}" \
  --statistic Average \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 100 \
  --comparison-operator LessThanThreshold \
  --alarm-actions "{topic-arn}" \
  --ok-actions "{topic-arn}" \
  --treat-missing-data breaching \
  --profile {profile}
```

**Note:** `treat-missing-data` is `breaching` here (unlike the ALB alarm which uses `notBreaching`). If the canary stops running entirely, we want to know.

### 13. Report Summary

```
Health Canary Setup Complete ({profile})

Resources created:
- S3 Bucket: survey-apps-synthetics-{profile}-{account-id}
- IAM Role: survey-apps-synthetics-canary-role
- Security Group: {canary-sg-id} (if VPC needed)
- Canary: {canary-name}
  - Endpoint: {health-url}
  - Schedule: Every 5 minutes
  - VPC: {vpc-id} (if internal ALB)
  - First run: {PASSED/FAILED}
- Alarm: survey-management-api-{profile}-health-canary-failed
  - Fires when SuccessPercent < 100%
  - Notifies: {topic-arn}

View in console:
https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#synthetics:canary/detail/{canary-name}

The IAM role and S3 bucket are reusable — to add more canaries for other services,
run this skill again with a different health endpoint and canary name.
```

## Adding Canaries for Other Services

This skill can be re-run to create additional canaries. The IAM role and S3 bucket
from the first run are reused automatically (Steps 6 and 7 check for existing resources).

Suggested canary names for the full suite:
- `mgmt-api-health` — survey-management-api (this skill)
- `field-api-health` — survey-fielding-api
- `mgmt-web-smoke` — survey-management-web (browser canary, future)
- `field-web-smoke` — survey-fielding-web (browser canary, future)

## Cleanup

To remove all canary resources:

```bash
aws synthetics stop-canary --name "{canary-name}" --profile {profile}
sleep 10
aws synthetics delete-canary --name "{canary-name}" --profile {profile}

aws cloudwatch delete-alarms \
  --alarm-names "survey-management-api-{profile}-health-canary-failed" \
  --profile {profile}

aws s3 rm s3://survey-apps-synthetics-{profile}-{account-id} --recursive --profile {profile}
aws s3 rb s3://survey-apps-synthetics-{profile}-{account-id} --profile {profile}

aws iam delete-role-policy \
  --role-name survey-apps-synthetics-canary-role \
  --policy-name synthetics-canary-permissions \
  --profile {profile}
aws iam delete-role \
  --role-name survey-apps-synthetics-canary-role \
  --profile {profile}

# Delete security group (if VPC was used)
aws ec2 delete-security-group \
  --group-id {canary-sg-id} \
  --profile {profile}
```
