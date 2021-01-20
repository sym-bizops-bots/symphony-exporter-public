# Symphony Exporter
Symphony Bot to export the current users messages from Rooms and IMs

## Usage
Start a 1:1 IM with the bot, and send #export.
The bot will retrive list of Rooms and IMs (streams) that the user is a participant in, export messages for each stream into a JSON formated file, compress all the files into a single ZIP and then send message back to the user with ZIP file attached.

## Setup
* Ensure you have access to a Symphony Pod with Rest APIs enabled
* Create a Bot Service User with **Content Management** permissions
* Create an OBO App
* Generate a RSA key pairs for bot and app `npm run genrsa`
* Save the private keys securely for deployment
* Copy the public keys to Pod Admin Portal
* Optionally, generate a ceservice certificate

## Run Locally
* Requires NodeJS to be installed
* Clone this respository and change into the project directory
* Make folder called "secrets" for the keys and config.json - avoid checking this into git repos for security
* Run `npm install`
* Run `npm start` or `node exporter`

## Generating ceservice Root CA and User Cert
Using OpenSSL 1.1.1

Generate the Root CA key and cert
```
openssl req -x509 -new -nodes -newkey rsa:4096 -sha512 -days 3650 -subj "/CN=exporterRootCA.crt" -keyout exporterRootCA.key -out exporterRootCA.crt
```
Upload the Root CA Cert to the pod via "Manage Certificates" in the Admin Portal e.g. https://develop.symphony.com/admin-console/index.html#certificates 

Generate a CSR and key for the ceservice User Cert, CN=ceservice
```
openssl req -new -nodes -newkey rsa:4096 -subj "/C=US/ST=NY/O=Symphony/OU=BizOps/CN=ceservice" -keyout ceservice.key -out ceservice.csr
```
Generate ceservice User Cert, signed using Root CA
```
openssl x509 -req -in ceservice.csr -sha512 -days 3650 -CA exporterRootCA.crt -CAkey exporterRootCA.key -CAcreateserial -out ceservice.crt
```

Package ceservice cert and key into p12 keystore, remember to add the keystore password to config.json
```
openssl pkcs12 -export -in ceservice.crt -inkey ceservice.key -certfile exporterRootCA.crt -name ceservice -out ceservice-cert.p12
```

Test using curl
```
curl --cert ceservice.crt --key ceservice.key -X POST https://develop-api.symphony.com:8444/sessionauth/v1/authenticate
```