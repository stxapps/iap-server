import { getPurchases, doIgnorePurchase } from './file';
import {
  APPSTORE, PLAYSTORE, PADDLE, COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER,
  ACTIVE, NO_RENEW, GRACE, ON_HOLD, PAUSED, EXPIRED, UNKNOWN,
} from './const';

const printAppReport = (
  appName, productId, sums, nACommitted, nPCommitted, nDCommitted
) => {
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
    '|', `${nACommitted}`.padStart(10, ' '),
    '|', `${sums[productId][APPSTORE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].active}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][APPSTORE].others}`.padStart(8, ' '),
  );
  console.log(
    'Google'.padEnd(8, ' '),
    '|', `${nPCommitted}`.padStart(10, ' '),
    '|', `${sums[productId][PLAYSTORE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].active}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][PLAYSTORE].others}`.padStart(8, ' '),
  );
  console.log(
    'Paddle'.padEnd(8, ' '),
    '|', `${nDCommitted}`.padStart(10, ' '),
    '|', `${sums[productId][PADDLE].tried}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].trying}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].active}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].activeNoRenew}`.padStart(8, ' '),
    '|', `${sums[productId][PADDLE].others}`.padStart(8, ' '),
  );
  console.log('');
};

const report = async () => {
  const purchaseFpath = process.argv[2];
  const purchaseUserFpath = process.argv[3];

  const purchases = await getPurchases(purchaseFpath, purchaseUserFpath, true);

  const date = new Date();
  const sums = {
    [COM_BRACEDOTTO_SUPPORTER]: {
      [APPSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
      [PLAYSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
      [PADDLE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
    },
    [COM_JUSTNOTECC_SUPPORTER]: {
      [APPSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
      [PLAYSTORE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
      [PADDLE]: { trying: 0, tried: 0, active: 0, activeNoRenew: 0, others: 0 },
    }
  };

  for (const purchase of purchases) {
    if (doIgnorePurchase(purchase)) continue;

    const { source, productId, status, endDate, createDate, userIds } = purchase;

    if (!Array.isArray(userIds) || userIds.length < 1) {
      console.log('*** IMPORTANT ***');
      console.log('Found no-user purchase:', purchase);
    }

    const dateDiff = endDate.getTime() - createDate.getTime();
    const isTrying = dateDiff <= 28 * 24 * 60 * 60 * 1000;

    if (status === EXPIRED) {
      if (isTrying) sums[productId][source].tried += 1;
      else sums[productId][source].others += 1;
      continue;
    }

    if (endDate.getTime() < date.getTime()) {
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

  const nBACommitted = (
    sums[COM_BRACEDOTTO_SUPPORTER][APPSTORE].active +
    sums[COM_BRACEDOTTO_SUPPORTER][APPSTORE].activeNoRenew
  );
  const nBPCommitted = (
    sums[COM_BRACEDOTTO_SUPPORTER][PLAYSTORE].active +
    sums[COM_BRACEDOTTO_SUPPORTER][PLAYSTORE].activeNoRenew
  );
  const nBDCommitted = (
    sums[COM_BRACEDOTTO_SUPPORTER][PADDLE].active +
    sums[COM_BRACEDOTTO_SUPPORTER][PADDLE].activeNoRenew
  );
  const nJACommitted = (
    sums[COM_JUSTNOTECC_SUPPORTER][APPSTORE].active +
    sums[COM_JUSTNOTECC_SUPPORTER][APPSTORE].activeNoRenew
  );
  const nJPCommitted = (
    sums[COM_JUSTNOTECC_SUPPORTER][PLAYSTORE].active +
    sums[COM_JUSTNOTECC_SUPPORTER][PLAYSTORE].activeNoRenew
  );
  const nJDCommitted = (
    sums[COM_JUSTNOTECC_SUPPORTER][PADDLE].active +
    sums[COM_JUSTNOTECC_SUPPORTER][PADDLE].activeNoRenew
  );

  const nCommitted = (
    nBACommitted + nBPCommitted + nBDCommitted + nJACommitted + nJPCommitted +
    nJDCommitted
  );

  printAppReport(
    'Brace.to', COM_BRACEDOTTO_SUPPORTER, sums, nBACommitted, nBPCommitted, nBDCommitted
  );
  printAppReport(
    'Justnote', COM_JUSTNOTECC_SUPPORTER, sums, nJACommitted, nJPCommitted, nJDCommitted
  );

  console.log('Total committed:', nCommitted);
  console.log('');
};

report();
