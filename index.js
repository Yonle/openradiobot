const openradio = require("openradio");
const slimbot = require("slimbot");
const { Server } = require("http");
const ytdl = require("ytdl-core");
const ytsr = require("ytsr");
const ytpl = require("ytpl");
const ms = require("ms");
require("dotenv").config();

const bot = new slimbot(process.env.BOT_TOKEN);
const server = new Server();
const radios = new Map();

const listener = server.listen(process.env.PORT || 3000, () => {
	console.log("Server is now on port", listener.address().port);
});

server.on('request', (req, res) => {
	let id = req.url.slice(1);
	if (isNaN(Number(id)) || !radios.has(id)) {
		res.writeHead(400);
		res.end("Invalid Request");
	} else {
		res.setHeader("content-type", "audio/mp3");
		radios.get(id).player.pipe(res);
		radios.get(id).metadata.listener++;
		radios.get(id).metadata.totalListener++;

		req.on('close', () => {
			if (!radios.get(id)) return;
			radios.get(id).metadata.listener--;
		});
	}
});

bot.on("message", message => {
	message.reply = async (text) => {
		if (!text || typeof text != "string") return Promise.resolve();
		if (text.length > 4096) {
			try {
				await bot.sendMessage(message.chat.id, text.slice(0, 4096), { parse_mode: "Markdown" });
				return await message.reply(text.slice(4096));
			} catch (error) {
				message.reply("An error occured: " + error.toString());
			}
		} else {
			if (!text.length) return Promise.resolve();
			try {
				await bot.sendMessage(message.chat.id, text, { parse_mode: "Markdown" });
				return Promise.resolve();
			} catch (error) {
				message.reply("An error occured: " + error.toString());
			}
		}
	};
	message.chat.id = message.chat.id.toString();
	if (!message.text.startsWith("/")) return;
	switch (message.text.split(" ")[0].slice(1)) {
		case "new": 
			if (radios.has(message.chat.id)) return message.reply("You already created your radio. To manage it, Type /manage. To destroy it, Type /destroy");
			radios.set(message.chat.id, {
				player: new openradio({
					bitrate: 192
				}),
				queue: [],
				metadata: {
					listener: 0,
					totalListener: 0,
					starttime: Date.now(),
					curSong: null,
					autoplay: false,
					loopType: "none"
				},
				play: function () {
					let client = radios.get(message.chat.id);
					if (!client) return;
					radios.get(message.chat.id).queue = radios.get(message.chat.id).queue.filter(song => song);
					if (client.metadata.loopType == "queue" && typeof(client.metadata.curSong) === "object") client.queue.push(client.metadata.curSong);
					if (client.metadata.loopType == "single" && typeof(client.metadata.curSong) === "object") client.queue.unshift(client.metadata.curSong);
					let nextSong = radios.get(message.chat.id).queue.shift();
					client.metadata.curSong = null;
					if (!nextSong) return;
					bot.sendChatAction(message.chat.id, 'typing');
					let stream = ytdl(nextSong.id, { filter: "audioonly", quality: "highestaudio" });
					stream.on('info', (info) => {
						bot.sendChatAction(message.chat.id, 'typing');
						client.metadata.curSong = info;
						//client.metadata.curSong.title = `[${info.videoDetails.title}](https://youtu.be/${info.videoDetails.videoId})`;
						client.metadata.curSong.id = info.videoDetails.videoId;
						client.player.play(stream).then(client.play);
						if (client.metadata.autoplay) {
							client.queue.push(info.related_videos[0]);
						}
						message.reply(`▶️Now playing:  ${client.metadata.curSong.title}`)
					});

					stream.on('error', err => message.reply(err.toString()));
				}
			})
			message.reply("✔️Radio Created");
			break;
		case "destroy": 
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			radios.get(message.chat.id).player.destroy();
			radios.delete(message.chat.id);
			message.reply("✔️Radio destroyed.");
			break;
		case "manage": 
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			(() => {
				let text = "*Your radio status*";
				text += `\nListener: \`${radios.get(message.chat.id).metadata.listener}\``;
				text += `\nTotal Listener: \`${radios.get(message.chat.id).metadata.totalListener}\``;
				text += `\nLoop Type: \`${radios.get(message.chat.id).metadata.loopType}\``;
				text += `\nCreated Since: \`${ms(Date.now() - radios.get(message.chat.id).metadata.starttime)}\``;
				if (radios.get(message.chat.id).metadata.curSong) text += `\nNow Playing: ${radios.get(message.chat.id).metadata.curSong.title}`;
				text += `\nAutoplay Enabled?: \`${radios.get(message.chat.id).metadata.autoplay ? "Yes" : "No"}\``;
				text += `\nTotal Queue: \`${radios.get(message.chat.id).queue.length}\``;
				text += `\nLive on: [${process.env.SERVER_HOST||"http://localhost:3000"}/${message.chat.id}](http://localhost:3000/${message.chat.id})`;
				text += `\n\nTo check song queue, Type /queue`;
				message.reply(text);
			})();
			break;
		case "queue":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radios.get(message.chat.id).queue.length) return message.reply("🏜️Nothing is in queue....");
			let method = message.text.split(" ").slice(1)[0];
			if (!method) return (() => {
				let text = "*Radio Queue*";
				radios.get(message.chat.id).queue.slice(0, 20).forEach((song, songNum) => {
					songNum++;
					text += `\n${songNum}. [${song.title}](https://youtu.be/${song.id})`;
				});
				text += "\n\n⚠️Some song is hidden due to a lot of request value. We'll improve this soon.\n\nYou may also manage these queue. For more information, Do `/queue help`";
				message.reply(text);
			})();
			
			if (method === "help") {
				let text = "*Queue Managing*";
				text += "\nUsage: `/queue [method] [argument]`";
				text += "\n\nAvailable Method:";
				text += "\n  remove  - Remove a song in a queue";
				text += "\n  move    - Move a song in a queue";
				text += "\n  shuffle - Sort queue into random order";
				text += "\n  random  - Alias of `shuffle`";
				message.reply(text);
			} else if (method === "remove") {
				let args = message.text.split(" ").slice(2)[0];
				if (!args) return message.reply("Usage: `/queue remove [Order number of song in /queue]`");
				if (!radios.get(message.chat.id).queue[Number(args)-1]) return message.reply("No song was found in Queue Order number " + args);
				delete radios.get(message.chat.id).queue[Number(args)-1];
				// Re-create. Ignore the undefined ones
				radios.get(message.chat.id).queue = radios.get(message.chat.id).queue.filter(song => song);
				message.reply(`✔️Song number ${args} has been removed.`);
			} else if (method === "move") {
				let args = message.text.split(" ").slice(2)[0];
				let to = message.text.split(" ").slice(3)[0];
				if (!args || !to) return message.reply("Usage: `/queue move [Order number] [To Order number]`");
				if (!radios.get(message.chat.id).queue[Number(args)-1] || !radios.get(message.chat.id).queue[Number(to)-1]) return message.reply("Song not found or invalid value.");
				let fromOrder = radios.get(message.chat.id).queue[Number(args)-1];
				let toOrder = radios.get(message.chat.id).queue[Number(to)-1];
				radios.get(message.chat.id).queue[Number(args)-1] = toOrder;
				radios.get(message.chat.id).queue[Number(to)-1] = fromOrder;
				message.reply(`✔️*${fromOrder.title}* order moved to *${toOrder.title}* order.`);
			} else if (method === "shuffle" || method === "random") {
				radios.get(message.chat.id).queue.sort(() => 0.5 - Math.random());
				message.reply("✔️Queue order has been sorted randomly.");
			}
			break;
		case "play":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let str = message.text.split(" ").slice(1).join(" ");
			if (!str.length) return message.reply("Usage: `/play [Song name]`");
			message.reply(`Searching \`${str}\`...`);
			bot.sendChatAction(message.chat.id, 'typing');
			if (str.toLowerCase().includes("youtube.com/playlist?list=")) {
				ytpl(str, { limit: Infinity, page: Infinity }).then(res => {
					if (!res.items.length) return message.reply("🙅No Result.");
					if (!radios.has(message.chat.id)) return;
					message.reply(`✔️${res.items.length} Song has been added to queue`);
					if (!radios.get(message.chat.id).queue.length && !radios.get(message.chat.id).metadata.curSong) {
						radios.get(message.chat.id).queue.push(res.items);
						radios.get(message.chat.id).queue = radios.get(message.chat.id).queue.flat(Infinity);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.chat.id, 'typing');
						radios.get(message.chat.id).play();
					} else {
						radios.get(message.chat.id).queue.push(res.items);
						radios.get(message.chat.id).queue = radios.get(message.chat.id).queue.flat(Infinity);
					}
				});
			} else {
				ytsr(str, { limit: 1 }).then(res => {
					bot.sendChatAction(message.chat.id, 'typing');
					res.items = res.items.filter(video => video.type == "video");
					if (!res.items.length) return message.reply("🙅No Result.");
					if (!radios.has(message.chat.id)) return;
					if (!radios.get(message.chat.id).queue.length && !radios.get(message.chat.id).metadata.curSong) {
						radios.get(message.chat.id).queue.push(res.items[0]);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.chat.id, 'typing');
						radios.get(message.chat.id).play();
					} else {
						radios.get(message.chat.id).queue.push(res.items[0]);
						message.reply(`✔️ [${res.items[0].title}](https://youtu.be/${res.items[0].id}) has been added to queue.`)
					}
				}).catch(err => {
					message.reply(`An error occured: ${err.toString()}`);
				});
			}
			break;
		case "pause":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			radios.get(message.chat.id).player.pause();
			message.reply("⏸️Paused");
			break;
		case "resume":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			radios.get(message.chat.id).player.resume();
			message.reply("▶️Resumed");
			break;
		case "skip":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radios.get(message.chat.id).queue.length) return message.reply("There's nothing in queue!");
			radios.get(message.chat.id).play();
			message.reply("⏩Skipping...");
			break;
		case "stop":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			radios.get(message.chat.id).player.stream.end();
			radios.get(message.chat.id).queue = [];
			message.reply("⏹️Player Stopped");
			break;
		case "autoplay":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let autoplay = radios.get(message.chat.id).metadata.autoplay;
			if (!autoplay) {
				radios.get(message.chat.id).metadata.autoplay = true;
				let info = radios.get(message.chat.id).metadata.curSong;
				radios.get(message.chat.id).queue.push(info.related_videos[0]);
				message.reply("✔️Autoplay enabled");
			} else {
				radios.get(message.chat.id).metadata.autoplay = false;
				message.reply("✔️Autoplay disabled");
			}
			break;
		case "loop":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			(() => {
				let loopType = message.text.split(" ").slice(1)[0];
				let availableLoopType = ["queue", "single", "none"];
				if (!loopType || !availableLoopType.includes(loopType)) return message.reply("Usage: `/loop [queue|single|none]`");
			
				radios.get(message.chat.id).metadata.loopType = loopType.toLowerCase();
				message.reply(`✔️Loop Type has been set as \`${loopType.toLowerCase()}\``);
			})();
			break;
		default:
			(() => {
				let text = "*OpenradioBot v0.0 Alpha*";
				text += "\n\n__Radio Managing__";
				text += "\n/new      - Create new radio";
				text += "\n/destroy  - Destroy current radio";
				text += "\n/manage   - Manage your radio";
				text += "\n\n__Player Managing__";
				text += "\n/play     - Play a song";
				text += "\n/pause    - Pause a player";
				text += "\n/resume   - Resume a player";
				text += "\n/skip     - Skip current song";
				text += "\n/stop     - Stop player";
				text += "\n/queue    - See & Manage queue list.";
				text += "\n/autoplay - Auto play next song from youtube **Related Videos** query.";
				text += "\n/loop     - Loop queue";
			
				message.reply(text);
			})();
			break;
	}
});

bot.startPolling(err => {
	if (err) console.error(err);
}).then(async () => console.log('Ready'));
process.on('unhandledRejection', err => console.log(err));
