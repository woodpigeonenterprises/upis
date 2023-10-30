import { DynamoDBClient, GetItemCommand, PutItemCommand, TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { err } from "./util.js";

const creds = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || err('Missing AWS_ACCESS_KEY_ID'),
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || err('Missing AWS_SECRET_ACCESS_KEY')
};

const sts = new STSClient({
  region: 'eu-west-1',
  credentials: creds
});

const dynamo = new DynamoDBClient({
  region: 'eu-west-1',
  credentials: creds
});

export async function createBand(uid: string) {
  const bid = crypto.randomUUID();

  // const r = await dynamo.send(new GetItemCommand({
  //   TableName: 'upis',
  //   Key: { key: { S: `user/${uid}` } },
  //   AttributesToGet: ['bands']
  // }));

  // if(!r.Item) err(`Couldn't find user ${uid}`);

  // const bands0 = r.Item.bands.SS as string[];

  // bands0.push(bid);

  const r = await dynamo.send(new TransactWriteItemsCommand({
    TransactItems: [
      new PutItemCommand({
        TableName: 'upis',
        Item: {
          key: { S: `band/${bid}` }
        }
      }),
      new UpdateItemCommand({
        Key: { key: { S: `user/${uid}` }},
        AttributeUpdates: {
          bands: { Action: 'ADD', Value: { S: bid } }
        }
      })
    ]
  }));

  console.log(r);
}

export async function userExists(uid: string): Promise<boolean> {
  const r = await dynamo.send(new GetItemCommand({
    TableName: 'upis',
    Key: { key: { S: `user/${uid}` } },
    AttributesToGet: ['state']
  }));

  return !!r.Item;
}


export async function getUserAwsCreds(uid: string): Promise<AwsCreds> {
  const r = await sts.send(new AssumeRoleCommand({
    RoleSessionName: uid,
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
                `user/${uid}`
              ]
          }
        }
      }
    })
  }));

  if(!r.Credentials) err(`Failed to assume role for ${uid}`);

  return {
    accessKeyId: r.Credentials.AccessKeyId || err('No AccessKeyId'),
    secretAccessKey: r.Credentials.SecretAccessKey || err('No SecretAccessKey'),
    sessionToken: r.Credentials.SessionToken || err('No SessionToken'),
    expires: r.Credentials.Expiration?.valueOf() || err('No Expiration')
  };
}

export type AwsCreds = {
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  expires: number
}

