resource "aws_iam_role" "lambda_role" {
  assume_role_policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Action\":\"sts:AssumeRole\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"}}]}"
  tags = {
    Name = "lambda-role"
  }
}
