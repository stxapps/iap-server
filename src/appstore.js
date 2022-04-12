// Inspired by https://github.com/ladeiko/node-apple-receipt-verify
//   and https://github.com/levibostian/dollabill-apple
import dollabillApple from 'dollabill-apple';

import { getAppstoreSecretKey } from './utils';

const verifySubscription = async (productId, token) => {
  const res = await dollabillApple.verifyReceipt({
    receipt: token, sharedSecret: getAppstoreSecretKey(productId)
  });
  return res;
};

const acknowledgeSubscription = async (/*userId,*/ productId, token) => {

};

const appstore = { verifySubscription, acknowledgeSubscription };
export default appstore;
