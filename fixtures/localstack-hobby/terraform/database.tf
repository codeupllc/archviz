resource "aws_dynamodb_table" "items" {
  name         = "archviz-hobby-items"
  hash_key     = "id"
  billing_mode = "PAY_PER_REQUEST"
  tags = {
    Name = "items"
  }

  attribute {
    name = "id"
    type = "S"
  }
}
