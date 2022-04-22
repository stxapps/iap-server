// Inspired by https://github.com/Deishelon/google-play-billing-validator
//             https://stackoverflow.com/questions/62054043/what-is-the-best-way-to-access-google-play-developers-api-with-node-js
import { google } from 'googleapis';

import { getAppId } from './utils';

const androidPublisher = google.androidpublisher('v3');
let didBindAuthClient = false;

const bindAuthClient = async () => {
  if (didBindAuthClient) return;

  const auth = new google.auth.GoogleAuth({
    keyFile: 'src/playstore-service-account.json',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const authClient = await auth.getClient();
  google.options({ auth: authClient });

  didBindAuthClient = true;
};

const verifySubscription = async (productId, token) => {
  await bindAuthClient();
  const res = await androidPublisher.purchases.subscriptions.get({
    packageName: getAppId(productId),
    subscriptionId: productId,
    token,
  });
  return res;
};

const acknowledgeSubscription = async (productId, token) => {
  await bindAuthClient();
  const res = await androidPublisher.purchases.subscriptions.acknowledge({
    packageName: getAppId(productId),
    subscriptionId: productId,
    token,
  });
  return res;
};

const playstore = { verifySubscription, acknowledgeSubscription };
export default playstore;
