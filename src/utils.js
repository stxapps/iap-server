import {
  COM_BRACEDOTTO, COM_JUSTNOTECC, COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER,
  COM_BRACEDOTTO_BRACE, COM_JUSTNOTECC_JUSTNOTE,
} from './const';
import appstoreKeys from './appstore-keys.json' with { type: 'json' };

export const runAsyncWrapper = (callback) => {
  return function (req, res, next) {
    callback(req, res, next).catch(next);
  }
};

export const getReferrer = (request) => {
  let referrer = request.get('Referrer');
  if (!referrer) referrer = request.get('Origin');
  return referrer;
};

export const randomString = (length) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;

  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};

export const sample = (arr) => {
  return arr[Math.floor(Math.random() * arr.length)];
};

export const removeTailingSlash = (url) => {
  if (url.slice(-1) === '/') return url.slice(0, -1);
  return url;
};

export const isObject = (val) => {
  return typeof val === 'object' && val !== null;
};

export const isString = (val) => {
  return typeof val === 'string';
};

export const isNumber = (val) => {
  return typeof val === 'number' && isFinite(val);
};

export const isFldStr = (val) => {
  return isString(val) && val.length > 0;
};

export const getAppId = (productId) => {
  if (productId === COM_BRACEDOTTO_SUPPORTER) return COM_BRACEDOTTO;
  if (productId === COM_JUSTNOTECC_SUPPORTER) return COM_JUSTNOTECC;
  return null;
};

export const getBundleId = (productId) => {
  if (productId === COM_BRACEDOTTO_SUPPORTER) return COM_BRACEDOTTO_BRACE;
  if (productId === COM_JUSTNOTECC_SUPPORTER) return COM_JUSTNOTECC_JUSTNOTE;
  return null;
};

export const getAppstoreSecretKey = (productId) => {
  const appId = getAppId(productId);
  if (appId === COM_BRACEDOTTO) return appstoreKeys['secretKeyBracedotto'];
  if (appId === COM_JUSTNOTECC) return appstoreKeys['secretKeyJustnotecc'];
  return null;
};

export const getAppstoreInfo = () => {
  const info = {
    issuerId: appstoreKeys['iapIssuerId'],
    keyId: appstoreKeys['iapKeyId'],
    privateKey: appstoreKeys['iapPrivateKey'],
  };
  return info;
};

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
