#!/bin/sh
npm install --production
npx next start -p $X_ZOHO_CATALYST_LISTEN_PORT
