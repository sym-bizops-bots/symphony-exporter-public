const Symphony = require('symphony-api-client-node');
const needle = require('needle');
const nJwt = require('njwt');
const fs = require('fs');
const jszip = require('jszip');

// basic string templating, limited to 10 args
const stringFormat = (template, args) => template.replace(/({([0-9])})+/gi, (m, g1, g2) => args[g2] || '');
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
// reply
const reply = (streamId, text, file = null) => {
    let msg = {
        streamId: streamId,
        text: text,
        format: Symphony.MESSAGEML_FORMAT
    };
    if (file) {
        msg.file = file;
        return Symphony.sendMessageWithAttachment(msg.streamId, msg.text, msg.data, msg.file.name, msg.file.type, msg.file.content, msg.format);
    } else {
        return Symphony.sendMessage(msg.streamId, msg.text, msg.data, msg.format);
    }
}
// template reply
const templateReply = (streamId, template, args, file = null) => {
    let text = stringFormat(template, args.map(x => escapeXml(x)));
    return reply(streamId, text, file)
}
// JWT
const getJwtToken = (privateKey, claims) => {
    var signingKey = fs.readFileSync(privateKey, 'utf8')
    var jwt = nJwt.create(claims, signingKey, 'RS512')
    jwt.setExpiration(new Date().getTime() + (3 * 60 * 1000))
    var token = jwt.compact()
    return token
}
// app auth
const appAuthAPI = (appId, appRSAKey) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] appAuthAPI ${appId}`);
    let url = `https://${Symphony.config.podHost}:${Symphony.config.podPort}/login/pubkey/app/authenticate`;
    let data;
    try {
        data = { token: getJwtToken(appRSAKey, { sub: appId }) };
    } catch (err) {
        return Promise.reject(err);
    }
    let options = { headers: { 'Content-Type': 'application/json' } };
    return needle('POST', url, data, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] appAuthAPI ${res.statusCode}`)
            Symphony.appSessionToken = res.body.token;
            return Symphony.appSessionToken;
        });
}
// obo
const oboAuthByUserIdAPI = (userId) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] oboAuthByUserIdAPI ${userId}`);
    let url = `https://${Symphony.config.podHost}:${Symphony.config.podPort}/login/pubkey/app/user/${userId}/authenticate`;
    let options = { headers: { 'sessionToken': Symphony.appSessionToken } };
    return needle('POST', url, null, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] oboAuthByUserIdAPI ${res.statusCode}`)
            if (res.statusCode == 200) return res.body.token;
            return Promise.reject('User is not authorized to export messages. Please have Pod Admin install and enable the app and try again.');
        });
}
const oboListUserStreamsAPI = (oboSessionToken, userId, limit = 1000) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] oboListUserStreamsAPI ${userId}`);
    let url = `https://${Symphony.config.podHost}:${Symphony.config.podPort}/pod/v1/streams/list?limit=${limit}`;
    let data = {
        streamTypes: [{ "type": "IM" }, { "type": "MIM" }, { "type": "ROOM" }],
        includeInactiveStreams: true
    };
    let options = { headers: { 'Content-Type': 'application/json', 'sessionToken': oboSessionToken } };
    return needle('POST', url, data, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] oboListUserStreamsAPI ${res.statusCode} ${res.statusMessage}`)
            return res.body;
        });
}
// ceservice user auth
const ceAuthenticate = () => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] ceAuthenticate Logging in with ceservice`);
    return ceSessionTokenAPI()
        .then(sessionToken => {
            Symphony.ceSessionToken = sessionToken;
            return ceKeyManagerTokenAPI()
        })
        .then(keyManagerToken => {
            Symphony.ceKeyManagerToken = keyManagerToken;
            return { sessionToken: Symphony.ceSessionToken, keyManagerToken: Symphony.ceKeyManagerToken }
        });
}
const ceSessionTokenAPI = () => {
    let url = `https://${Symphony.config.ceSessionAuthHost}:${Symphony.config.ceSessionAuthPort}/sessionauth/v1/authenticate`;
    let options = {
        pfx: fs.readFileSync(Symphony.config.ceCert),
        passphrase: Symphony.config.ceCertPassword
    };
    return needle('POST', url, null, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] ceSessionTokenAPI ${res.statusCode} ${res.statusMessage}`)
            if (res.statusCode == 200 && res.body && res.body.token) return res.body.token;
            else return Promise.reject(`${res.statusCode} ${res.statusMessage}`);
        });
}
const ceKeyManagerTokenAPI = () => {
    let url = `https://${Symphony.config.ceKeyAuthHost}:${Symphony.config.ceKeyAuthPort}/keyauth/v1/authenticate`;
    let options = {
        pfx: fs.readFileSync(Symphony.config.ceCert),
        passphrase: Symphony.config.ceCertPassword
    };
    return needle('POST', url, null, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] ceKeyManagerTokenAPI ${res.statusCode} ${res.statusMessage}`)
            if (res.statusCode == 200 && res.body && res.body.token) return res.body.token;
            else return Promise.reject(`${res.statusCode} ${res.statusMessage}`);
        });
}
// Stream Members
const getStreamMembersAPI = (streamId) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getStreamMembersAPI ${streamId}`);
    let url = `https://${Symphony.config.podHost}:${Symphony.config.podPort}/pod/v1/admin/stream/${streamId}/membership/list`;
    let options = {
        headers: {
            'sessionToken': Symphony.botSessionToken,
            'keyManagerToken': Symphony.botKeyManagerToken
        }
    };
    return needle('GET', url, null, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getStreamMembersAPI ${streamId} ${res.statusCode} ${res.statusMessage}`)
            return res.body.members || res.body;
        });
}
// Stream Messages
const delay = interval => new Promise(resolve => setTimeout(resolve, interval));

const getStreamMessagesAPI = async (streamId, since = 0, limit = 500) => {
    await delay(Math.floor(Math.random()*1000));

    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getStreamMessagesAPI ${streamId}`);
    let url = `https://${Symphony.config.agentHost}:${Symphony.config.agentPort}/agent/v4/stream/${streamId}/message?since=${since}&limit=${limit}`;
    let options = {
        headers: {
            'sessionToken': (Symphony.config.ceEnabled) ? Symphony.ceSessionToken : Symphony.botSessionToken,
            'keyManagerToken': (Symphony.config.ceEnabled) ? Symphony.ceKeyManagerToken : Symphony.botKeyManagerToken
        }
    };
    return needle('GET', url, null, options)
        .then(res => {
            if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getStreamMessagesAPI ${streamId} ${res.statusCode} ${res.statusMessage}`)
            if (res.statusCode == 200) return res.body;
            else return Promise.reject(res.body);
        });
}
// Get all messages from a users streams
const getAllMessagesForUserId = (userId, since, to, streamMessageLimit) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getAllMessagesForUserId userId=${userId}, since=${since}, to=${to}, streamMessageLimit=${streamMessageLimit}`);
    return appAuthAPI(Symphony.config.appId, Symphony.config.appRSAKey)
        .then(() => {
            if (Symphony.config.ceEnabled) return ceAuthenticate();
            else return;
        })
        .then(() => oboAuthByUserIdAPI(userId))
        .then(oboSessionToken => oboListUserStreamsAPI(oboSessionToken, userId))
        .then(streams => getAllMessagesFromStreams(userId, streams, since, to, streamMessageLimit));
}
// Get all messages from list of streams
const getAllMessagesFromStreams = (userId, streams, since = (Date.now() - 1000 * 60 * 60 * 24), to = Date.now(), streamMessageLimit) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getAllMessagesFromStreams userId=${userId}, streams=${streams.length}, since=${since}, to=${to}, streamMessageLimit=${streamMessageLimit}`);
    let promiseArray = [];
    streams.forEach(stream => {
        promiseArray.push(() => buildStreamInfo(userId, stream, since, to, streamMessageLimit))
    });
    return promiseArray.reduce((chain, current) => {
        return chain.then(chainResults => {
            return current().then(currentResult => [...chainResults, currentResult])
        });
    }, Promise.resolve([]))
        .then(res => {
            return res;
        });
}
// Build streamInfo from a stream, optional userId used to filter by membership
const buildStreamInfo = (userId, stream, since = (Date.now() - 1000 * 60 * 60 * 24), to = Date.now(), streamMessageLimit) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] buildStreamInfo userId=${userId}, stream=${stream.id}, since=${since}, to=${to}, streamMessageLimit=${streamMessageLimit}`);
    let streamInfo = {
        id: stream.id,
        type: stream.streamType.type,
        name: (stream.roomAttributes) ? stream.roomAttributes.name : '',
        crosspod: stream.crossPod,
        active: stream.active,
        members: [],
        messages: []
    }
    return getStreamMembersAPI(streamInfo.id)
        .then(members => {
            if (members && members.length > 0) {
                streamInfo.members = members;
            };
        })
        .then(() => {
            if (userId && streamInfo.type == 'ROOM') {
                return Symphony.getRoomInfo(streamInfo.id)
                    .then(res => {
                        if (res.roomAttributes && res.roomAttributes.viewHistory == false) {
                            let u = streamInfo.members.find(m => m.user.userId == userId);
                            if (u && u.joinDate && u.joinDate > since) {
                                since = u.joinDate
                                console.log(`${new Date().toJSON()} [WARN] Symphony.getRoomInfo ${streamInfo.id} viewHistory=${res.roomAttributes.viewHistory} joinDate > since. Only fetching messages since joinDate ${since}`);
                            }
                        }
                    })
                    .fail(err => {
                        console.log(`${new Date().toJSON()} [WARN] Symphony.getRoomInfo ${streamInfo.id} problem getting room info, skipping room`);
                        Promise.reject(err);
                    });
            }
        })
        .then(() => {
            if (!userId || streamInfo.members.find(m => m.user.userId == userId)) {
                return getStreamMessagesBetweenTimestamps(streamInfo.id, since, to, streamMessageLimit)
                    .then(messages => {
                        if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] ${streamInfo.id} exported ${messages.length} messages since ${since}`)
                        messages.reverse();
                        streamInfo.messages = messages;
                    })
            }
        })
        .then(() => {
            return streamInfo;
        })
}

// TODO: Add rucursive function for fetching messages between dates
const getStreamMessagesBetweenTimestamps = (streamId, since = 0, to = new Date().getTime(), streamMessageLimit) => {
    if (Symphony.config.debugMode) console.log(`${new Date().toJSON()} [DEBUG] getStreamMessagesBetweenTimestamps ${streamId} ${since} ${to}`);
    let results = [];
    if (since > to) {
        // since must <= to
        return Promise.resolve(results);
    }
    let apiLimit = 500;

    const getStreamMessagesBetweenTimestampsRecursive = (streamId, since, to) => {
        return new Promise(function (resolve) {
            getStreamMessagesAPI(streamId, since, apiLimit)
                .then(messages => resolve(messages))
                .catch(err => {
                    if (err) err = JSON.stringify(err);
                    console.error(`${new Date().toJSON()} [ERROR] getStreamMessagesBetweenTimestampsRecursive/getStreamMessagesAPI`, err);
                })
        }).then((messages) => {
            if (messages.length < apiLimit || messages[0].timestamp > to) {
                messages = messages.filter(m => m.timestamp <= to);
                if (streamMessageLimit > 0) {
                    results = messages.slice(results.length - streamMessageLimit).concat(results);
                } else {
                    results = messages.concat(results);
                }
                return results;
            } else {
                results = messages.concat(results);
                let newSince = messages[0].timestamp;
                return getStreamMessagesBetweenTimestampsRecursive(streamId, newSince, to);
            }
        })
    }
    return getStreamMessagesBetweenTimestampsRecursive(streamId, since, to);
}

const sendZip = (streamId, text, zip, filename) => {
    let file = {
        name: filename || 'messages.zip',
        type: 'application/zip',
        content: zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
    };
    return reply(streamId, text, file)
}

const zipStreams = (streams, format = 'csv') => {
    var zip = new jszip();
    let promises = streams.map(stream => {
        if (stream.messages && stream.messages.length > 0) {
            let fileName = `${stream.type}-${stream.name ? `${stream.name.replace(/[^\w]/ig, '')}-` : ``}${stream.id}`;
            if (!format || format == 'csv') {
                // CSV
                let csvLines = stream.messages.map(msg => {
                    return `"${msg.messageId}","${new Date(msg.timestamp).toJSON()}","${(msg.user) ? msg.user.userId : '-'}","${(msg.user) ? msg.user.displayName : '-'}","${msg.message}"`;
                })
                csvLines.unshift('messageId,date,senderId,senderName,message');
                let fileContents = csvLines.join('\n');
                zip.file(`${fileName}.csv`, fileContents);
            }
            if (format == 'json') {
                // JSON
                let fileContents = JSON.stringify(stream, null, 2);
                zip.file(`${fileName}.json`, fileContents);
            }
            if (format == 'eml') {
                let fileContents = generateStreamEml(stream);
                zip.file(`${fileName}.eml`, fileContents);
            }
        }
    });
    return Promise.all(promises)
        .then(() => zip);
}

const generateStreamEml = (stream) => {
    // EML, 1 file per stream, each message in stream wrapped in <p> tag    
    let nowDate = new Date();
    let creatorOrOwner = stream.members.find(m => m.isCreator) || stream.members.find(m => m.isOwner);
    let memberEmails = stream.members.map(m => m.user.email);
    let messages = stream.messages.map(msg => {
        return `<p><font color="grey">Message ID: ${msg.messageId}</font><br>${new Date(msg.timestamp).toJSON()} ${(msg.user) ? msg.user.displayName : '???'} - ${(msg.user) ? msg.user.email : '???'} says:<br>${msg.message}<br></p>`;
    })
    let boundry = `----=${stream.id}.${nowDate.getTime()}`;
    return `Date: ${nowDate.toString()}
From: ${creatorOrOwner.user.email}
To: ${memberEmails.join(',')}
Message-ID: <${stream.id}.${nowDate.getTime()}@symphony.com>
Subject: Symphony: ${stream.members.length} users, ${stream.messages.length} messages
MIME-Version: 1.0
Content-Type: multipart/mixed; 
    boundary="${boundry}"
x-globalrelay-MsgType: SymphonyPost
x-symphony-StreamType: SymphonyPost
x-symphony-StreamID: ${stream.id}
x-symphony-FileGeneratedDateUTC: ${nowDate.getTime()}

--${boundry}
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: 7bit

<!DOCTYPE html><html><body>
${messages.join('')}
<hr>Generated by Symphony Message History Bot | Stream Type: ${stream.type} | Stream ID: ${stream.id} | File Generated Date: ${nowDate.toJSON()} <br>
</body></html>
--${boundry}--`;
}

const exportMessages = (replyToStreamId, user, since, to, format) => {
    console.log(`${new Date().toJSON()} [INFO] exportMessages | replyToStreamId=${replyToStreamId}, user=${user.userId}, since=${since}, to=${to}`);
    return getAllMessagesForUserId(user.userId, since, to)
        .then(streams => {
            return zipStreams(streams, 'json')
                .then(zip => sendZip(replyToStreamId, '', zip, `messages.${since}.${to}.json.zip`))
                .then(() => zipStreams(streams, 'csv'))
                .then(zip => sendZip(replyToStreamId, '', zip, `messages.${since}.${to}.csv.zip`))
                .then(() => zipStreams(streams, 'eml'))
                .then(zip => sendZip(replyToStreamId, '', zip, `messages.${since}.${to}.eml.zip`))
        })
        .then(() => {
            console.log(`${new Date().toJSON()} [INFO] exportMessages | replyToStreamId=${replyToStreamId}, user=${user.userId} | DONE`);
            return templateReply(replyToStreamId, Symphony.config.templates.complete, [user.firstName || ''])
        })
}

const Exports = {
    appAuthAPI: appAuthAPI,
    oboAuthByUserIdAPI: oboAuthByUserIdAPI,
    oboListUserStreamsAPI: oboListUserStreamsAPI,
    getStreamMembersAPI: getStreamMembersAPI,
    getStreamMessagesAPI: getStreamMessagesAPI,

    ceAuthenticate: ceAuthenticate,

    templateReply: templateReply,

    getAllMessagesForUserId, getAllMessagesForUserId,
    exportMessages: exportMessages,
    buildStreamInfo: buildStreamInfo,
    zipStreams: zipStreams,
    getAllMessagesFromStreams: getAllMessagesFromStreams,
    getStreamMessagesBetweenTimestamps, getStreamMessagesBetweenTimestamps,

    generateStreamEml: generateStreamEml,
}
module.exports = Exports