---
description: Create SNS alert topic + CloudWatch alarm on ALB 5xx errors for a survey-apps service
argument-hint: "[aws-profile]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# Purpose

Set up an SNS notification topic and a CloudWatch alarm that fires when an ALB target group returns too many 5xx errors. This is the foundation of the alerting pipeline — run this before setting up canaries.

No application code changes required. This is pure AWS infrastructure.

## Instructions

### 1. Determine AWS Profile

**If argument provided:**
- Use it as the AWS profile name (e.g., `dev`, `stage`, `prod`)

**If no argument:**
- Use AskUserQuestion:
  - Options: `dev`, `stage`, `prod`
  - Question: "Which AWS environment should we set up alerting in?"

### 2. Verify AWS Session

```bash
aws sts get-caller-identity --profile {profile}
```

**If error (expired SSO):**
Report: "SSO session expired. Run `aws sso login --profile {profile}` and try again."
Stop.

**If success:**
Confirm: "Authenticated as {ARN} in account {Account}."

### 3. Check for Existing SNS Topic

```bash
aws sns list-topics --profile {profile} --query 'Topics[].TopicArn' --output text
```

Look for a topic matching `survey-apps-{profile}-alerts` in the output.

**If topic already exists:**
Report: "SNS topic already exists: {arn}. Skipping creation."
Use the existing ARN for subsequent steps.

**If no matching topic:**
Proceed to create one.

### 4. Create SNS Topic

```bash
aws sns create-topic --name survey-apps-{profile}-alerts --profile {profile}
```

Save the `TopicArn` from the response.

### 5. Subscribe an Email

Use AskUserQuestion:
- Question: "What email should receive alert notifications?"
- Options: suggest the email from the SSO identity if available, plus "Other"

```bash
aws sns subscribe \
  --topic-arn "{topic-arn}" \
  --protocol email \
  --notification-endpoint "{email}" \
  --profile {profile}
```

Report: "Confirmation email sent to {email}. You must click the confirmation link before alerts will deliver."

### 6. Discover ALB and Target Groups

```bash
aws elbv2 describe-target-groups \
  --profile {profile} \
  --query 'TargetGroups[].{Name:TargetGroupName,ARN:TargetGroupArn,Port:Port,HealthCheck:HealthCheckPath,ALBs:LoadBalancerArns[0]}'
```

Present the target groups to the user. Use AskUserQuestion if there are multiple:
- Question: "Which target group should we alarm on?"
- List each target group with its name, port, and health check path

Extract the **ARN suffixes** for CloudWatch dimensions:
- Target group suffix: everything after `...:targetgroup/` → `targetgroup/{name}/{id}`
- ALB suffix: everything after `...:loadbalancer/` → `app/{name}/{id}`

If the ALB ARN isn't in the target group response, look it up:

```bash
aws elbv2 describe-load-balancers --profile {profile} --query 'LoadBalancers[].{Name:LoadBalancerName,ARN:LoadBalancerArn}'
```

### 7. Check for Existing Alarm

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix "survey-management-api-{profile}" \
  --profile {profile} \
  --query 'MetricAlarms[].AlarmName'
```

If an alarm matching `survey-management-api-{profile}-5xx-errors` already exists, report it and ask if the user wants to overwrite.

### 8. Create the CloudWatch Alarm

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "survey-management-api-{profile}-5xx-errors" \
  --alarm-description "ALB 5xx errors on survey-management-api in {profile} - fires when more than 5 errors in 5 minutes" \
  --namespace "AWS/ApplicationELB" \
  --metric-name "HTTPCode_Target_5XX_Count" \
  --dimensions \
    "Name=TargetGroup,Value={target-group-suffix}" \
    "Name=LoadBalancer,Value={alb-suffix}" \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions "{topic-arn}" \
  --ok-actions "{topic-arn}" \
  --treat-missing-data notBreaching \
  --profile {profile}
```

### 9. Verify

```bash
aws cloudwatch describe-alarms \
  --alarm-names "survey-management-api-{profile}-5xx-errors" \
  --profile {profile} \
  --query 'MetricAlarms[0].{Name:AlarmName,State:StateValue,Metric:MetricName,Threshold:Threshold}'
```

### 10. Offer Test

Use AskUserQuestion:
- Question: "Want to test the notification pipeline? This will force the alarm into ALARM state — you'll get an email, and it auto-recovers in ~5 minutes."
- Options: "Yes, test it", "No, skip"

**If yes:**

```bash
aws cloudwatch set-alarm-state \
  --alarm-name "survey-management-api-{profile}-5xx-errors" \
  --state-value ALARM \
  --state-reason "Testing notification pipeline - manually triggered" \
  --profile {profile}
```

Report: "Alarm triggered. Check your email — you should get a notification now, and a recovery notification in ~5 minutes."

### 11. Report Summary

```
ALB Alerting Setup Complete ({profile})

Resources created:
- SNS Topic: {topic-arn}
- Subscriber: {email}
- Alarm: survey-management-api-{profile}-5xx-errors
  - Watches: HTTPCode_Target_5XX_Count > 5 in 5 min
  - Target Group: {target-group-name}

Next steps:
- Run /core:setup-health-canary {profile} to add synthetic monitoring
- Add more subscribers (Slack, PagerDuty) to the SNS topic as needed
```
