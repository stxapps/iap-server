const express = require('express');
const cors = require('cors');
const { Datastore } = require('@google-cloud/datastore');

const { runAsyncWrapper } = require('./utils');
const { ALLOWED_ORIGINS } = require('./const');

const datastore = new Datastore();

const app = express();
app.use(express.json());

const extractCorsOptions = {
  'origin': ALLOWED_ORIGINS,
}

app.get('/', (_req, res) => {
  res.status(200).send('Welcome to <a href="https://www.stxapps.com">STX Apps</a>\'s server!').end();
});

app.options('/status', cors(extractCorsOptions));
app.post('/status', cors(extractCorsOptions), runAsyncWrapper(async (req, res) => {

}));

// Listen to the App Engine-specified port, or 8088 otherwise
const PORT = process.env.PORT || 8088;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
  console.log('Press Ctrl+C to quit.');
});
