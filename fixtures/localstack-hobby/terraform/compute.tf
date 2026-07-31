resource "aws_lambda_function" "handler" {
  function_name = "archviz-hobby-handler"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  filename      = "function.zip"
  role          = aws_iam_role.lambda_role.arn
  tags = {
    Name = "handler"
  }
}

# reads-from: handler → items (consume on assumed role)
resource "aws_iam_role_policy" "handler_dynamodb_consume_items" {
  name = "handler-dynamodb-consume-items"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:DescribeTable", "dynamodb:ConditionCheckItem"]
        Resource = [
          aws_dynamodb_table.items.arn,
          "${aws_dynamodb_table.items.arn}/index/*",
        ]
      }
    ]
  })
}
