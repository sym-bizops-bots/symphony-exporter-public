const Symphony = require('symphony-api-client-node');
const Exporter = require('../Exporter/index.js');
const fs = require('fs');


let testList = {
    templateReply: () => {
        let streamId = Symphony.config.testStream;
        let template = '<card><header>Hello <b>{0}</b>!<br/>How are you {1}?</header></card>';
        let args = ['Tester', 'today'];
        return Exporter.templateReply(streamId, template, args)
            .then(res => (res && res.message && res.message.includes('<div class="card"><div class="cardHeader">Hello <b>Tester</b>!<br/>How are you today?</div></div>')));
    },

    appAuthAPI: () => {
        return Exporter.appAuthAPI(Symphony.config.appId, Symphony.config.appRSAKey)
            .then(res => (res && res == Symphony.appSessionToken))
    },

    ceAuthenticate: () => {
        return Exporter.ceAuthenticate()
            .then(res => (res && res.sessionToken == Symphony.ceSessionToken && res.keyManagerToken == Symphony.ceKeyManagerToken))
    },

    oboListUserStreamsAPI: () => {
        let userId = Symphony.config.testUserId;
        let limit = 5;
        return Exporter.appAuthAPI(Symphony.config.appId, Symphony.config.appRSAKey)
            .then(() => Exporter.oboAuthByUserIdAPI(userId))
            .then(token => Exporter.oboListUserStreamsAPI(token, userId, limit))
            .then(res => {
                console.log(res);
                return (res.length > 0 && res.length <= limit)
            })
    },

    getStreamMembersAPI: () => {
        let streamId = Symphony.config.testStream;
        return Exporter.getStreamMembersAPI(streamId)
            .then(res => {
                console.log(res);
                return (res.length > 0)
            })
    },

    getStreamMessagesAPI: () => {
        let streamId = Symphony.config.testStream;
        let since = new Date(new Date().toDateString()).getTime();
        let limit = 5;
        return Exporter.ceAuthenticate()
            .then(() => Exporter.getStreamMessagesAPI(streamId, since, limit))
            .then(res => {
                console.log(res.map(m => ({ messageId: m.messageId, timestamp: m.timestamp, message: m.message })))
                return (res.length > 0 && res.length <= limit && res[0].timestamp >= since)
            })
    },

    getStreamMessagesBetweenTimestamps: () => {
        console.time('getStreamMessagesBetweenTimestamps');
        let streamId = Symphony.config.testStream;
        let since = new Date().getTime() - 1000 * 60 * 60 * 24;
        let to = new Date().getTime();
        let streamMessageLimit = 100;
        return Exporter.ceAuthenticate()
            .then(() => Exporter.getStreamMessagesBetweenTimestamps(streamId, since, to, streamMessageLimit))
            .then(res => {
                console.log(`${new Date().toJSON()} [TEST] Finished export, streamId:${streamId}, since:${since}, to:${to}, streamMessageLimit:${streamMessageLimit}
        total : ${res.length}
        first : ${res[res.length - 1].timestamp}, ${new Date(res[res.length - 1].timestamp).toLocaleString()}
                ${res[res.length - 1].message}
        last    : ${res[0].timestamp}, ${new Date(res[0].timestamp).toLocaleString()}
                ${res[0].message}`);
                process.stdout.write(`${new Date().toJSON()} [TEST] `); console.timeEnd('getStreamMessagesBetweenTimestamps');
                return (res.length <= streamMessageLimit && res[res.length - 1].timestamp >= since && res[0].timestamp <= to)
            })
    },

    getAllMessagesForUserId: () => {
        console.time('getAllMessagesForUserId');
        let user = { userId: Symphony.config.testUserId, firstName: 'Test', displayName: 'Test' };
        return Exporter.getAllMessagesForUserId(user.userId)
            .then(streams => {
                for (let i = 0; i < streams.length; i++) {
                    if(stream.messages.length > 0) {
                        const stream = streams[i];
                        let fileName = `${stream.type}-${stream.name ? `${stream.name.replace(/[^\w]/ig, '')}-` : ``}${stream.id}`;
                        fs.writeFileSync(`${__dirname}/test.${fileName}.json`, JSON.stringify(stream, null, 4));
                    }
                }
                const messages = streams.flatMap(x => x.messages).sort((x,y) => (x.timestamp - y.timestamp));
                console.log(`${new Date().toJSON()} [TEST] exported ${messages.length} messages from ${streams.length} streams`)                
                process.stdout.write(`${new Date().toJSON()} [TEST] `); console.timeEnd('getAllMessagesForUserId');
                return (messages.length);
            })
    },

    simpleLoadTest: () => {
        let loadCount = process.env.LOADCOUNT || 1;
        console.log(`${new Date().toJSON()} [TEST] load test with LOADCOUNT=${loadCount}`)        

        let userId = Symphony.config.testUserId;
        let since = 0;
        console.log(`${new Date().toJSON()} [TEST] START`);

        for (i = 0; i < loadCount; i++) {
            console.time(`simpleLoadTest[${i}]`);
            Exporter.getAllMessagesForUserId(userId)
                .then(res => console.log(`${new Date().toJSON()} [TEST] END ${res.length}`))
                .catch(err => console.error(`${new Date().toJSON()} [TEST] ERROR ${err}`))
        }
        return true;
    },
}


Symphony.initBot(__dirname + '/secrets/test.json')
    .then((SymBot) => {
        Symphony.config.debugMode = process.env.DEBUGMODE || Symphony.config.debugMode;
        Symphony.setDebugMode(Symphony.config.debugMode);
        Symphony.botSessionToken = SymBot.sessionAuthToken;
        Symphony.botKeyManagerToken = SymBot.kmAuthToken;
        return;
    })
    .then(() => {
        let testNumber = process.argv[2];
        if (testList && testNumber == null) {
            return Object.keys(testList).reduce((chain, test, i) => {
                return chain.then(() => {
                    console.log(`${new Date().toJSON()} [TEST] Running test #${i} ${test}`);
                    return testList[test]();
                })
            }, Promise.resolve());
        } else if (testList && testNumber >= 0 && testNumber < Object.keys(testList).length) {
            console.log(`${new Date().toJSON()} [TEST] Running test #${testNumber} ${Object.keys(testList)[testNumber]}`);
            return Object.values(testList)[testNumber]();
        } else {
            console.log(`${new Date().toJSON()} [TEST] ${testNumber} invalid test number`);
        }
    })
    .then(pass => {
        console.log(`${new Date().toJSON()} [TEST] Pass=${(pass) ? 'true' : 'false'}`);
    })
    .fail(err => {
        if (err) err = JSON.stringify(err);
        console.error(`${new Date().toJSON()} [TEST] ERROR ${err}`);
    })