import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { getUserAwsCreds } from "./users.js";

const uid = 'bez@wibble.com';
const creds = await getUserAwsCreds(uid);

console.log('CREDS', creds);

if(creds) {
  const dynamo = new DynamoDBClient({
    region: 'eu-west-1',
    credentials: creds
  });

  const cmd = new GetItemCommand({
    TableName: 'upis',
    Key: { key: { S: `user/${uid}` } }
  });


  const response = await dynamo.send(cmd);

  console.log('USERENTRY', response);
}

