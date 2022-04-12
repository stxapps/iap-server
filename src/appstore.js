import appleReceiptVerify from "node-apple-receipt-verify";

import { getAppstoreSecretKey } from './utils';

appleReceiptVerify.config({
  verbose: true,
  ignoreExpiredError: true,
  ignoreExpired: false,
  extended: true,
  //environment: ['production'], // or sandbox
  excludeOldTransactions: true,
});

const verifySubscription = async (productId, token) => {
  const secretKey = getAppstoreSecretKey(productId);
  const purchasedProducts = await appleReceiptVerify.validate({
    receipt: token, secret: secretKey,
  });
  return purchasedProducts;
};

const acknowledgeSubscription = async (/*userId,*/ productId, token) => {

};

const appstore = { verifySubscription, acknowledgeSubscription };
export default appstore;
