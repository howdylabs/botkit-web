var express = require('express');
var path = require('path');
var WebSocket = require('ws');

module.exports = function(botkit) {

    var plugin = {
        name: 'Botkit for the Web',
        web: [{
            url: '/chat',
            method: 'get',
            handler: function(req, res) {
                var relativePath = path.relative(process.cwd() + '/views', __dirname + '/views');
                res.render(relativePath + '/chat');
            }
        }],
        menu: [{
            title: 'Chat',
            url: '/chat',
            icon: '💬',
        }],
        middleware: {
            send: [
                function(bot, message, next) {
                    if (bot.type == 'web' && message.files && message.files.length) {
                        for (var f = 0; f < message.files.length; f++) {
                            // determine if this is an image or any other type of file.
                            message.files[f].image =
                                (message.files[f].url.match(/\.(jpeg|jpg|gif|png)$/i) != null);
                        }
                    }
                    next();
                },
                function(bot, message, next) {
                    if (bot.type == 'web') {
                        message.type = 'message';
                    }
                    next();
                }
            ],
            spawn: [
                function(bot, next) {

                    if (bot.type == 'web') {
                        bot.send = function(message) {
                            return new Promise(function(resolve, reject) {
                                if (bot.connected || !bot.ws) {
                                    if (bot.ws) {
                                        try {
                                            if (bot.ws && bot.ws.readyState === WebSocket.OPEN) {
                                                if (!message.type) {
                                                    message.type = 'outgoing';
                                                }
                                                bot.ws.send(JSON.stringify(message), function(err) {
                                                    if (err) {
                                                        reject(err);
                                                    } else {
                                                        resolve(message);
                                                    }
                                                });
                                            } else {
                                                console.error('Cannot send message to closed socket');
                                            }
                                        } catch (err) {
                                            return reject(err);
                                        }
                                    } else {
                                        try {
                                            bot.http_response.json(message);
                                            resolve(message);
                                        } catch (err) {
                                            reject(err);
                                        }
                                    }
                                } else {
                                    setTimeout(function() {
                                        bot.send(message).then(resolve).catch(reject);
                                    }, 3000);
                                }
                            });
                        };

                        bot.startTyping = function() {
                            if (bot.connected) {
                                try {
                                    if (bot.ws && bot.ws.readyState === WebSocket.OPEN) {
                                        bot.ws.send(JSON.stringify({
                                            type: 'typing'
                                        }), function(err) {
                                            if (err) {
                                                console.error('startTyping failed: ' + err.message);
                                            }
                                        });
                                    } else {
                                        console.error('Socket closed! Cannot send message');
                                    }
                                } catch (err) {
                                    console.error('startTyping failed: ', err);
                                }
                            }
                        };

                        bot.typingDelay = function(message) {

                            return new Promise(function(resolve, reject) {
                                var typingLength = 0;
                                if (message.typingDelay) {
                                    typingLength = message.typingDelay;
                                } else {
                                    var textLength;
                                    if (message.text) {
                                        textLength = message.text.length;
                                    } else {
                                        textLength = 80; //default attachement text length
                                    }

                                    var avgWPM = 150;
                                    var avgCPM = avgWPM * 7;

                                    typingLength = Math.min(Math.floor(textLength / (avgCPM / 60)) * 1000, 5000);
                                }

                                setTimeout(function() {
                                    resolve();
                                }, typingLength);
                            });

                        };

                        bot.replyWithTyping = function(src, resp, cb) {

                            return new Promise(function(resolve, reject) {
                                bot.startTyping();
                                bot.typingDelay(resp).then(function() {

                                    if (typeof(resp) == 'string') {
                                        resp = {
                                            text: resp
                                        };
                                    }

                                    resp.user = src.user;
                                    resp.channel = src.channel;
                                    resp.to = src.user;

                                    bot.say(resp, cb).then(resolve).catch(reject);
                                });
                            });
                        };

                        bot.reply = function(src, resp) {

                            if (typeof(resp) == 'string') {
                                resp = {
                                    text: resp
                                };
                            }

                            resp.user = src.user;
                            resp.channel = src.channel;
                            resp.to = src.user;

                            if (resp.typing || resp.typingDelay || controller.config.replyWithTyping) {
                                return bot.replyWithTyping(src, resp, cb);
                            } else {
                                return bot.say(resp, cb);
                            }
                        };
                    }
                    next();

                }
            ],
        },
        init: function(botkit) {

            // make bundled assets available
            botkit.webserver.use("/plugins/chat", express.static(__dirname + "/public"));

            openSocketServer(botkit.httpserver);

        }
    }

    function openSocketServer(server) {
        // create the socket server along side the existing webserver.
        var wss = new WebSocket.Server({
            server
        });

        function heartbeat() {
            this.isAlive = true;
        }

        wss.on('connection', function connection(ws) {
            ws.isAlive = true;
            ws.on('pong', heartbeat);

            botkit.spawn('web', {}).then(function(bot) {
                bot.ws = ws;
                bot.connected = true;

                ws.on('message', function incoming(message) {

                    var message = JSON.parse(message);
                    botkit.receive(bot, message, ws);

                });

                ws.on('error', (err) => console.log('Websocket Error: ', err));

                ws.on('close', function(err) {
                    // console.log('CLOSED', err);
                    bot.connected = false;
                });
            });

        });

        var interval = setInterval(function ping() {
            wss.clients.forEach(function each(ws) {
                if (ws.isAlive === false) {
                    return ws.terminate();
                }
                //  if (ws.isAlive === false) return ws.terminate()
                ws.isAlive = false;
                ws.ping('', false, true);
            });
        }, 30000);

    }

    return plugin;
}
