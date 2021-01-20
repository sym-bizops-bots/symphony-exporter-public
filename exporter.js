const Symphony = require('symphony-api-client-node');
const Exporter = require('./Exporter/index.js');
const bot = require('bot-commander');

// escape XML helper
const escapeXml = unsafe => {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}
// basic string templating, limited to 10 args
const stringFormat = (template, args) => template.replace(/({([0-9])})+/gi, (m, g1, g2) => args[g2] || '');


bot.prefix(['/', '#']);
bot.lowerCase();

bot.help = () => {
    return Symphony.config.templates.help;
};

bot.command('*', { noHelp: true })
    .action((message, ...args) => {
        console.log(`${new Date().toJSON()} [INFO] command * help`);
        bot.send(message, Symphony.config.templates.help);
    })

bot.command('history [since] [to]')
    .alias('export')
    .usage('history [since] [to]')
    .description('Export message history from all user streams')
    .action((message, sinceInput, toInput) => {
        return new Promise((resolve, reject) => {
            console.log(`${new Date().toJSON()} [INFO] command export | user: ${message.user.userId}, streamType: ${message.stream.streamType}, messageText : ${message.messageText}, since : ${sinceInput}, to : ${toInput}`);

            let to = Date.now();
            let since = to-1000*60*60*24;

            if(sinceInput) {
                let parsedSince = Date.parse(sinceInput);
                if(!parsedSince) {
                    return Exporter.templateReply(message.stream.streamId, Symphony.config.templates.invalidDate+Symphony.config.templates.help,[]);
                }
                since = parsedSince; 
            }

            if(toInput) {
                let parsedTo = Date.parse(toInput);
                if(!parsedTo) {
                    return Exporter.templateReply(message.stream.streamId, Symphony.config.templates.invalidDate+Symphony.config.templates.help,[]);
                }
                to = parsedTo; 
            }

            if(since < 0 || to < 0 || since > to) {
                return Exporter.templateReply(message.stream.streamId, Symphony.config.templates.invalidDate+Symphony.config.templates.help,[]);
            }

            let dateText = `since ${new Date(since).toDateString()}`;
            if(toInput) dateText += ` to ${new Date(to).toDateString()}`;

            Exporter.templateReply(message.stream.streamId, Symphony.config.templates.start, [message.user.firstName, dateText]);

            return Exporter.exportMessages(message.stream.streamId, message.user, since, to)
                .catch(err => reject(err));

        }).catch(err => {
            if(err) err = JSON.stringify(err, '', 2);
            console.error(`${new Date().toJSON()} [ERROR] Exporter.exportMessages`, err);            
            Exporter.templateReply(message.stream.streamId, Symphony.config.templates.error, [message.user.firstName, err]);
        });
    });


bot.setSend((originalMessage, reply) => {
    return new Promise((resolve, reject) => {
        let streamId = originalMessage.stream.streamId;
        let format = Symphony.MESSAGEML_FORMAT;
        return Symphony.sendMessage(streamId, reply, null, format);
    }).catch(err => {
        if(err) err = JSON.stringify(err);
        console.error(`${new Date().toJSON()} [ERROR] bot.send ${err}`)});
})

// datafeed handlers
const onError = (err) => {
    if(err) err = JSON.stringify(err);
    console.error(`${new Date().toJSON()} [ERROR] datafeedEventsService onError ${err}`)
}
const onMessage = (messages) => {
    return Promise.all(messages.map(message => {
        // only parse messages from IMs
        if (message.stream.streamType == 'IM') {
            message.messageText = message.message.replace(/<[^>]*>/g, '').trim();
            bot.parse(message.messageText, message);
        }
    }));
}

Symphony.initBot(process.env.CONFIGPATH || __dirname + '/secrets/config.json')
    .then((SymBot) => {
        Symphony.config.debugMode = process.env.DEBUGMODE || Symphony.config.debugMode;
        Symphony.setDebugMode(Symphony.config.debugMode);
        Symphony.botSessionToken = SymBot.sessionAuthToken;
        Symphony.botKeyManagerToken = SymBot.kmAuthToken;
        return;
    })
    .then(() => Symphony.getDatafeedEventsService({ onMessage, onError }))
    .fail(err => {
        if(err) err = JSON.stringify(err);
        console.error(`${new Date().toJSON()} [ERROR] initBot ${err}`)
    })