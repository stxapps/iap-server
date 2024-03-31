import { getPurchases, doIgnorePurchase, isObsoletePurchase } from './file';
import {
  APPSTORE, PLAYSTORE, PADDLE, COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER,
  ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, EXPIRED, UNKNOWN,
} from './const';
import { isObject } from './utils';

const printAppReport = (appName, productId, sums, appTotal) => {
  for (const storeName of [APPSTORE, PLAYSTORE, PADDLE]) {
    for (const sumAttr in appTotal) {
      appTotal[sumAttr] += sums[productId][storeName][sumAttr];
    }
  }

  console.log('');
  console.log(appName);
  console.log(
    ''.padStart(8, ' '),
    '|', 'Committed'.padStart(10, ' '),
    '|', 'Tried'.padStart(8, ' '),
    '|', 'Trying'.padStart(8, ' '),
    '|', 'Active'.padStart(8, ' '),
    '|', 'No renew'.padStart(8, ' '),
    '|', 'Others'.padStart(8, ' '),
  );
  console.log(
    'Apple'.padEnd(8, ' '),
    '|', `${sums[productId][APPSTORE].committed}`.padStart(10, ' '),
    '|', `${sums[productId][APPSTORE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].active}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].others}`.padStart(8, ' '),
  );
  console.log(
    'Google'.padEnd(8, ' '),
    '|', `${sums[productId][PLAYSTORE].committed}`.padStart(10, ' '),
    '|', `${sums[productId][PLAYSTORE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].active}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].others}`.padStart(8, ' '),
  );
  console.log(
    'Paddle'.padEnd(8, ' '),
    '|', `${sums[productId][PADDLE].committed}`.padStart(10, ' '),
    '|', `${sums[productId][PADDLE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].active}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].others}`.padStart(8, ' '),
  );
  console.log(
    ' '.padEnd(8, ' '),
    ' ', `${appTotal.committed}`.padStart(10, ' '),
    '|', `${appTotal.tried}`.padStart(8, ' '),
    '|', `${appTotal.trying}`.padStart(8, ' '),
    '|', `${appTotal.active}`.padStart(8, ' '),
    '|', `${appTotal.activeNoRenew}`.padStart(8, ' '),
    '|', `${appTotal.others}`.padStart(8, ' '),
  );
  console.log('');
};

const printTotal = (sums, total) => {
  for (const productId of [COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER]) {
    for (const storeName of [APPSTORE, PLAYSTORE, PADDLE]) {
      for (const sumAttr in total) {
        total[sumAttr] += sums[productId][storeName][sumAttr];
      }
    }
  }

  console.log('');
  console.log(
    'Total'.padEnd(8, ' '),
    '|', `${total.committed}`.padStart(10, ' '),
    '|', `${total.tried}`.padStart(8, ' '),
    '|', `${total.trying}`.padStart(8, ' '),
    '|', `${total.active}`.padStart(8, ' '),
    '|', `${total.activeNoRenew}`.padStart(8, ' '),
    '|', `${total.others}`.padStart(8, ' '),
  );
  console.log('');
};

const calCommitted = (status, dateDiff) => {
  let committed = 0, dateLeft = dateDiff - 14;
  while (true) {
    dateLeft -= 365;
    if (dateLeft < -28) break; // possible no trail period.
    committed += 1;
  }
  //Check if calculate correctly.
  //console.log(`dateDiff: ${Math.round(dateDiff)}, committed: ${committed}`);
  return committed;
};

const report = async () => {
  const purchaseFpath = process.argv[2];
  const purchaseUserFpath = process.argv[3];

  const purchases = await getPurchases(purchaseFpath, purchaseUserFpath, true);

  const initSumAttrs = {
    trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0, committed: 0,
  };
  const sums = {
    [COM_BRACEDOTTO_SUPPORTER]: {
      [APPSTORE]: { ...initSumAttrs },
      [PLAYSTORE]: { ...initSumAttrs },
      [PADDLE]: { ...initSumAttrs },
    },
    [COM_JUSTNOTECC_SUPPORTER]: {
      [APPSTORE]: { ...initSumAttrs },
      [PLAYSTORE]: { ...initSumAttrs },
      [PADDLE]: { ...initSumAttrs },
    }
  };

  for (const purchase of purchases) {
    if (doIgnorePurchase(purchase)) continue;

    const { source, productId, status, endDate, createDate, userIds } = purchase;

    if (!isObject(createDate)) {
      console.log('Found no-createDate purchase:', purchase);
      continue;
    }
    if (status !== EXPIRED && (!Array.isArray(userIds) || userIds.length !== 1)) {
      console.log('Found wrong-user purchase:', purchase);
    }

    const dateDiff = (endDate.getTime() - createDate.getTime()) / (24 * 60 * 60 * 1000);
    const committed = calCommitted(status, dateDiff);
    const isTrying = committed === 0;

    sums[productId][source].committed += committed;

    if (status === EXPIRED) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].others += 1;
      continue;
    }

    if (isObsoletePurchase(purchase)) {
      // If not expired and endDate is behind today, status is obsolete,
      //   should call reverify.
      console.log('Found obsolete status:', purchase);
    }

    if (status === UNKNOWN) {
      console.log('Found unknown status:', purchase);
      continue;
    }

    if ([GRACE, ON_HOLD, PAUSED].includes(status)) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].others += 1;
      continue;
    }

    if (status === NO_RENEW) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].activeNoRenew += 1;
      continue;
    }

    if (status === ACTIVE) {
      if (isTrying) sums[productId][source].trying += 1;
      else sums[productId][source].active += 1;
      continue;
    }

    console.log('Invalid purchase:', purchase);
  }

  printAppReport('Brace.to', COM_BRACEDOTTO_SUPPORTER, sums, { ...initSumAttrs });
  printAppReport('Justnote', COM_JUSTNOTECC_SUPPORTER, sums, { ...initSumAttrs });
  printTotal(sums, { ...initSumAttrs });
};

report();
