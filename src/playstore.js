// Inspired by https://github.com/Deishelon/google-play-billing-validator
import { google } from 'googleapis';

import { getAppId } from './utils';

const auth = new google.auth.GoogleAuth({
  keyFile: 'src/playstore-service-account.json',
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const authClient = await auth.getClient();
google.options({ auth: authClient });

const androidPublisher = google.androidpublisher('v3');

const verifySubscription = async (productId, token) => {
  const res = await androidPublisher.purchases.subscriptions.get({
    packageName: getAppId(productId),
    subscriptionId: productId,
    token,
  });
  return res;
};

const acknowledgeSubscription = async (/*userId,*/ productId, token) => {
  const res = await androidPublisher.purchases.subscriptions.acknowledge({
    packageName: getAppId(productId),
    subscriptionId: productId,
    token,
    /*requestBody: {
      'developerPayload': `userId:${userId}`,
    },*/
  });
  return res;
};

const playstore = { verifySubscription, acknowledgeSubscription };
export default playstore;
