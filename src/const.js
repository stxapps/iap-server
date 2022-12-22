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

// Download Apple Root CA - G3 at https://www.apple.com/certificateauthority and run
//   openssl x509 -inform der -in AppleRootCA-G3.cer -noout -text -fingerprint -sha256
export const APPLE_ROOT_CA_G3_FINGERPRINTS = [
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79',
];

// Source
export const APPSTORE = 'AppStore';
export const PLAYSTORE = 'PlayStore';
//export const PADDLE = 'Paddle';
export const MANUAL = 'Manual';

export const SOURCES = [APPSTORE, PLAYSTORE];

// App id
export const COM_BRACEDOTTO = 'com.bracedotto';
export const COM_JUSTNOTECC = 'com.justnotecc';

export const APP_IDS = [COM_BRACEDOTTO, COM_JUSTNOTECC];

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
export const VERIFY_LOG = 'VerifyLog';
export const NOTIFY_LOG = 'NotifyLog';
export const ACKNOWLEDGE_LOG = 'AcknowledgeLog';

export const PURCHASE = 'Purchase';
export const PURCHASE_EXTRA = 'PurchaseExtra';
export const PURCHASE_USER = 'PurchaseUser';

// Status
export const ACTIVE = 'Active';
export const NO_RENEW = 'NoRenew';
export const GRACE = 'GracePeriod';
export const ON_HOLD = 'OnHold';
export const PAUSED = 'Paused';
export const EXPIRED = 'Expired';
//export const UNKNOWN = 'UNKNOWN';

// Acknowledge status
export const NO_ACK = 'NoAck';
export const DONE_ACK = 'DoneAck';
export const CANT_ACK = 'CantAck';

// Test string
export const SIGNED_TEST_STRING = 'Privacy Security UX';
