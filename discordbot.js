var needle = require('needle'),
	WS = require('websocket').w3cwebsocket;

/*
How to use: 
	1. Place this file in the same folder as your bot's file.
	2. Create a filename.js file for your bot.
	3. At the top, add these lines of code:
		var Naifubot = require('./discordbot.js');
		var nb = new Naifubot('bot email', 'bot password');
	4. Install Node.js from https://nodejs.org/download/
	5. Open Terminal or command prompt, and do the following commands:
		npm install needle
		npm install websocket
	6. You're good to go! Run the bot by typing this in the terminal:
		node path/to/your/filename.js

Documentation:
	Add event listeners to your bot by doing:
		nb.on('event', callback);
	where callback is a function to call whenever the specific event is
	triggered. All events pass an object to the callback function.

	Events:
		
		'init': triggers when the bot is ready to roll
		'chat': triggers when someone sends a message
		'edit': triggers when someone edits their message
		'delete': triggers when someone deletes a message
		'typing': triggers when someone starts typing
		'user_join': triggers when someone joins discord
		'user_leave': triggers when someone leaves discord
		'name_change': triggers when someone changes their username
		'voice_update': triggers when someone changes voice settings
		'new_user': triggers when a new user is added to discord
		'channel_update': triggers when a channel is modified
		'channel_create': triggers when a channel is created
		'channel_delete': triggers when a channel is deleted

*/

module.exports = function(email, password, twitch_id) {
	var bot = this;
	var req_options = {
		json: true,
		headers: {
			origin: 'https://discordapp.com'
		}
	};
	var ws;
	this.self = null;

	function login() {
		var login_info = {
			email: email,
			password: password
		};
		request('post', '/auth/login', login_info, function(err, res) {
			if (err) {
				throw err;
			}
			req_options.headers.authorization = res.body.token;
			ws_connect(res.body.token);
		});

		function ws_connect(token) {
			var sock_url = "wss://discordapp.com/hub";
			ws = new WS(sock_url, null, 'https://discordapp.com');
			ws.ready = false;
			ws.onopen = function() {
				var auth = {
					op: 2,
					d: {
						token: token,
						properties: {
							"$os": "Windows",
							"$browser": "Node.js",
							"$device": "",
							"$referrer": "https://google.ca",
							"$referring_domain": "www.google.ca",
							"$search_engine": "google"
						},
						v: 2
					}
				};
				ws.send(auth);
			};
			ws.onmessage = function(msg) {
				ws_event(msg.data);
			};
			ws.onclose = function() {
				console.log("Disconnected from Socket!");
			};
			ws.__send_ = ws.send;
			ws.send = function(msg) {
				ws.__send_(JSON.stringify(msg));
			};
		}
		function ws_event(msg) {
			try {
				var data = JSON.parse(msg);
			} catch (err) {
				console.log('ERROR WITH JSON PARSE: ');
				console.log(msg);
			}
			var event_type = data.t;
			if (event_type == 'READY') {
				init(data.d);
			} else if (!ws.ready) {
				temp_queue.push(data);
			} else if (event_type in sock_events) {
				for (var i = 0; i < sock_events[event_type].length; i++) {
					sock_events[event_type][i](data.d);
				}
			} else {
				console.log("Unused event: ", data);
			}
		}
		function init(data) {
			/* this bot relies on the fact that it is part of only one server.
			   may change that later, but for now, keep it to one server. */

			// bot info just in case?
			bot.self = data.user;

			// create our user list
			var users = data.guilds[0].members;
			var statuses = data.guilds[0].presences;
			server.users = users.map(function(user) {
				var status = statuses.filter(function(user_status) {
					return user_status.user.id == user.user.id;
				});
				return {
					username: user.user.username,
					id: user.user.id,
					discriminator: user.user.discriminator, // what is this?
					roles: user.roles,
					status: status.length ? status[0].status : 'offline'
				};
			});

			// create our channel list
			var channels = data.guilds[0].channels;
			server.channels = channels.filter(function(channel) {
				return channel.type == 'text';
			}).map(function(channel) {
				return {
					name: channel.name,
					id: channel.id
				};
			});
			
			// list of existing PMs
			var chats = data.private_channels;
			server.private_chats = chats.map(function(chat) {
				return {
					channel_id: chat.id,
					user_id: chat.recipient.id
				};
			});

			// list of existing roles
			server.roles = data.guilds[0].roles;

			// heartbeat so we stay connected to the server
			setInterval(function() {
				ws.send({op: 1, d: Date.now()});
			}, data.heartbeat_interval);

			// get initial stream status
			bot.check_stream(function() {
				// we ready boys
				ws.ready = true;
				for (var i = 0; i < temp_queue.length; i++) {
					ws_event(temp_queue[i]);
				}
				temp_queue = undefined;
				console.log(bot.self.username + ' now running!');
				bot.trigger('init');
			});
		}
	}

	/* general shit */
	var server = {
		users: [],
		channels: [],
		private_chats: [],
		roles: [],
		nairo_stream: false
	};

	/* event shit */
	var sock_events = {};
	var temp_queue = [];
	var bot_events = {};

	function onsock(ev, callback) {
		if (callback) {
			if (ev in sock_events) {
				sock_events[ev].push(callback);
			} else {
				sock_events[ev] = [callback];
			}
		}
	}
	this.on = function(ev, callback, once) {
		if (callback) {
			var handler = {f: callback, once: once};
			if (ev in bot_events) {
				bot_events[ev].push(handler);
			} else {
				bot_events[ev] = [handler];
			}
		}
	};
	this.off = function(ev, callback) {
		if (callback) {
			for (var i = 0; i < bot_events[ev].length; i++) {
				if (bot_events[ev][i].f == callback) {
					bot_events[ev].splice(i, 1);
					break;
				}
			}
		} else {
			delete bot_events[ev];
		}
	};
	this.trigger = function(ev, data) {
		if (bot_events[ev]) {
			for (var i = 0; i < bot_events[ev].length; i++ ) {
				bot_events[ev][i].f(data);
				if (bot_events[ev][i].once) {
					bot_events[ev].splice(i, 1);
					i--;
				}
			}
		}
	};

	onsock('MESSAGE_CREATE', function(obj) {
		var data = {
			msg: obj.content,
			channel: obj.channel_id,
			user: bot.get_user(obj.author.id)
		};

		bot.trigger('chat', data);
	});

	onsock('MESSAGE_UPDATE', function(obj) {
		// alright, i can see some use for this
		bot.trigger('edit', obj);
	});

	onsock('MESSAGE_DELETE', function(obj) {
		// ._.
		bot.trigger('delete', obj);
	});

	onsock('TYPING_START', function(obj) {
		// come on why would you ever need this
		bot.trigger('typing', obj);
	});

	onsock('PRESENCE_UPDATE', function(obj) {
		var data = obj.user;
		for (var i = 0; i < server.users.length; i++) {
			if (server.users[i].id == obj.user.id) {
				if (server.users[i].username != obj.user.username) {
					bot.trigger('name_change', data);
					server.users[i].username = obj.user.username;
				} else if (server.users[i].status == 'offline') {
					bot.trigger('user_join', data);
					server.users[i].status = obj.status;
				} else if (obj.status == 'offline') {
					server.users[i].status = obj.status;
					bot.trigger('user_leave', data);
				}
			}
		}
	});

	onsock('VOICE_STATE_UPDATE', function(obj) {
		// again... you don't need this.
		bot.trigger('voice_update', obj);
	});

	onsock('GUILD_UPDATE', function(obj) {
		server.roles = obj.roles;
	});

	onsock('GUILD_MEMBER_ADD', function(obj) {
		var data = {
			username: obj.user.username,
			id: obj.user.id,
			discriminator: obj.user.discriminator,
			roles: obj.roles,
			status: 'online'
		};
		server.users.push(data);

		bot.trigger('new_user', data);
	});

	onsock('GUILD_MEMBER_UPDATE', function(obj) {
		var data = {
			roles: obj.roles
		};
		for (var i = 0; i < server.users.length; i++) {
			if (server.users[i].id == obj.user.id) {
				data.user = server.users[i];
				server.users[i].roles = obj.roles;
				bot.trigger('role_update', data);
				break;
			}
		}
	});

	onsock('GUILD_MEMBER_REMOVE', function(obj) {
		var user = obj.user;
		for (var i = 0; i < server.users.length; i++) {
			if (server.users[i].id == user.id) {
				server.users.splice(i, 1);
				bot.trigger('user_remove', user);
				break;
			}
		}
	});

	onsock('CHANNEL_UPDATE', function(obj) {
		for (var i = 0; i < server.channels.length; i++) {
			if (server.channels[i].id == obj.id) {
				server.channels[i].name = obj.name;
				break;
			}
		}
		bot.trigger('channel_update', obj);
	});

	onsock('CHANNEL_CREATE', function(obj) {
		if (!obj.is_private && obj.type == text) {
			server.channels.push({
				name: obj.name,
				id: obj.id
			});

			bot.trigger('channel_create', obj);
		}
	});

	onsock('CHANNEL_DELETE', function(obj) {
		if (!obj.is_private && obj.type == text) {
			for (var i = 0; i < server.channels.length; i++) {
				if (server.channels[i].id == obj.id) {
					server.channels.splice(i, 1);
					bot.trigger('channel_delete', obj);
					break;
				}
			}
		}
	});

	/* bot methods */
	this.send_chat = function(channel, msg) {
		var data = {
			content: msg,
			mentions: []
		};
		request('post', '/channels/' + channel + '/messages', data);
	};

	this.private_message = function(user, msg) {
		var channel = null;
		for (var i = 0; i < server.private_chats.length; i++) {
			if (server.private_chats[i].user_id == user.id) {
				channel = server.private_chats[i].channel_id;
				break;
			}
		}
		if (!channel) {
			var payload = {recipient_id: user.id};
			request("post", "/users/" + bot.self.id + "/channels", payload, function(err, res) {
				if (err) {
					throw err;
				}
				channel = res.body.id;
				server.private_chats.push({
					channel_id: channel,
					user_id: user.id
				});
				bot.send_chat(channel, msg);
			});
		} else {
			bot.send_chat(channel, msg);
		}
	};

	this.get_channel = function(arg) {
		for (var i = 0; i < server.channels.length; i++) {
			if (arg === server.channels[i].id || arg === server.channels[i].name) {
				return server.channels[i];
			}
		}
		return null;
	};

	this.get_user = function(arg) {
		for (var i = 0; i < server.users.length; i++) {
			if (arg === server.users[i].id || arg === server.users[i].username) {
				return server.users[i];
			}
		}
		return null;
	};

	this.get_users= function(arg) {
		if (arg == 'online') {
			return server.users.filter(function(user) {
				return user.status != 'offline';
			});
		}
		return server.users.slice();
	};

	this.check_stream = function(callback) {
		if (!twitch_id) {
			return;
		}
		var options = {
			headers: {
				'Client-ID': twitch_id, // twitch api client id
				'Accept': 'application/vnd.twitchtv.v3+json'
			}
		};
		needle.get('https://api.twitch.tv/kraken/streams/nairomk', options, function(err, res) {
			if (err) {
				throw err;
			}
			var stream_status = !!res.body.stream;
			var data = {
				stream: res.body.stream
			};
			if (server.nairo_stream != stream_status) {
				data.changed = true;
				data.online = stream_status;
			}
			server.nairo_stream = stream_status;
			if (callback) {
				callback(data);
			}
		});
	};

	login();

	/* misc */
	function request(method, url, data, callback) {
		needle.request(method, "https://discordapp.com/api" + url, data, req_options, callback);
	}
};