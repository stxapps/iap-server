export const ALLOWED_ORIGINS = [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'https://localhost:3000',
  'https://192.168.1.40:3000',
  'https://192.168.1.41:3000',
  'https://192.168.1.42:3000',
  'https://192.168.1.43:3000',
  'https://192.168.1.44:3000',
  'https://192.168.1.45:3000',
  'https://192.168.1.46:3000',
  'https://d2r7uroqj51uls.cloudfront.net',
  'https://brace.to',
  'https://d2kp6vvq64w651.cloudfront.net',
  'https://justnote.cc',
];

// Source
export const APPSTORE = 'AppStore';
export const PLAYSTORE = 'PlayStore';
//export const PADDLE = 'Paddle';

export const SOURCES = [APPSTORE, PLAYSTORE];

// App id
export const COM_BRACEDOTTO = 'com.bracedotto';
export const COM_JUSTNOTECC = 'com.justnotecc';

// Product id
export const COM_BRACEDOTTO_SUPPORTER = 'com.bracedotto.supporter';
export const COM_JUSTNOTECC_SUPPORTER = 'com.justnotecc.supporter';

export const PRODUCT_IDS = [COM_BRACEDOTTO_SUPPORTER, COM_JUSTNOTECC_SUPPORTER];

// Verification result
export const VALID = 'VALID';
export const INVALID = 'INVALID';
export const UNKNOWN = 'UNKNOWN';
export const ERROR = 'ERROR';

// Topic
//export const PLAYSTORE_NOTIFICATIONS_BRACEDOTTO = 'playstore-notifications-bracedotto';
//export const PLAYSTORE_NOTIFICATIONS_JUSTNOTECC = 'playstore-notifications-justnotecc';

// Table
export const VERIFICATION = 'Verification';
export const NOTIFICATION = 'Notification';
export const ACKNOWLEDGEMENT = 'Acknowledgement';

export const PURCHASE = 'Purchase';
export const USER = 'User';

// Status
export const PENDING = 'PENDING'; // Payment pending
export const ACTIVE = 'ACTIVE'; // Payment received
export const FREE_TRIAL = 'FREE_TRIAL';

export const EXPIRED = 'EXPIRED';
export const CANCELLED = 'CANCELLED';
