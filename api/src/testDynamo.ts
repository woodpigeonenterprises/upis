import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const creds = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};

const sts = new STSClient({
  region: 'eu-west-1',
  credentials: creds
});

async function getSubject(id: string): Promise<Subject> {
  const r = await sts.send(new AssumeRoleCommand({
    RoleSessionName: id,
    RoleArn: 'arn:aws:iam::874522027524:role/UpisUser',
    DurationSeconds: 900,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: {
        Effect: 'Allow',
        Action: 'dynamodb:GetItem',
        Resource: 'arn:aws:dynamodb:eu-west-1:874522027524:table/upis',
        Condition: {
          "ForAllValues:StringEquals": {
              "dynamodb:LeadingKeys": [
                `user/${id}`
              ]
          }
        }
      }
    })
  }));

  if(!r.Credentials) throw Error(`Failed to assume role for ${id}`);

  return {
    id: id,
    creds: {
      accessKeyId: r.Credentials.AccessKeyId || (() => {throw Error('No AccessKeyId')})(),
      secretAccessKey: r.Credentials.SecretAccessKey || (() => {throw Error('No SecretAccessKey')})(),
      sessionToken: r.Credentials.SessionToken || (() => {throw Error('No SessionToken')})(),
    },
    expires: r.Credentials.Expiration?.getDate() || (() => {throw Error('No Expiration')})(),
  };
}




type Subject = {
  id: string,
  creds: AwsUserCreds,
  expires: number
};

type AwsUserCreds = {
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
}






const sub = await getSubject('bez@wibble.com');

console.log('CREDS', sub);

if(sub) {
  const dynamo = new DynamoDBClient({
    region: 'eu-west-1',
    credentials: sub.creds
  });

  const cmd = new GetItemCommand({
    TableName: 'upis',
    Key: { key: { S: `user/${sub.id}` } }
  });


  const response = await dynamo.send(cmd);

  console.log('USERENTRY', response);
}

