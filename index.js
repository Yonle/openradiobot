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
	message.reply = (text) => bot.sendMessage(message.chat.id, text, { parse_mode: "Markdown" });
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
					if (client.metadata.loopType == "queue") client.queue.push(client.metadata.curSong);
					if (client.metadata.loopType == "single") client.queue.unshift(client.metadata.curSong);
					let nextSong = radios.get(message.chat.id).queue.shift();
					client.metadata.curSong = null;
					if (!nextSong) return;
					bot.sendChatAction(message.chat.id, 'typing');
					let stream = ytdl(nextSong.id, { filter: "audioonly", quality: "highestaudio" });
					stream.on('info', (info) => {
						bot.sendChatAction(message.chat.id, 'typing');
						client.metadata.curSong = info;
						client.metadata.curSong.title = `[${info.videoDetails.title}](https://youtu.be/${info.videoDetails.videoId})`;
						client.metadata.curSong.id = info.videoDetails.videoId;
						client.player.play(stream).then(client.play);
						if (client.metadata.autoplay) {
							client.queue.push(info.related_videos[0]);
						}
						message.reply(`▶️Now playing:  ${client.metadata.curSong.title}`)
					});
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
				text += `\nLive on: [${process.env.SERVER_HOST||"http://localhost:3000"}/${message.chat.id}](http://localhost:3000/${message.chat.id})`;
				text += `\n\nTo check song queue, Type /queue`;
				message.reply(text);
			})();
			break;
		case "queue":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radios.get(message.chat.id).queue.length) return message.reply("🏜️Nothing is in queue....");
			(() => {
				let text = "*Radio Queue*";
				radios.get(message.chat.id).queue.forEach((song, songNum) => {
					songNum++;
					text += `\n${songNum}. [${song.title}](https://youtu.be/${song.id})`;
				});
				message.reply(text);
			})();
			break;
		case "play":
			if (!radios.has(message.chat.id)) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let str = message.text.split(" ").slice(1).join(" ");
			if (!str.length) return message.reply("Usage: `/play [Song name]`");
			message.reply(`Searching \`${str}\`...`);
			bot.sendChatAction(message.chat.id, 'typing');
			ytsr(str, { limit: 1 }).then(res => {
				bot.sendChatAction(message.chat.id, 'typing');
				res.items = res.items.filter(video => video.type == "video");
				if (!res.items.length) return message.reply("🙅No Result.");
				if (!radios.has(message.chat.id)) return;
				if (!radios.get(message.chat.id).queue.length && !radios.get(message.chat.id).metadata.curSong) {
					radios.get(message.chat.id).queue.push(res.items[0]);
					message.reply("Preparing to play...");
					radios.get(message.chat.id).play();
				} else {
					radios.get(message.chat.id).queue.push(res.items[0]);
					message.reply(`✔️ [${res.items[0].title}](https://youtu.be/${res.items[0].id}) has been added to queue.`)
				}
			}).catch(err => {
				message.reply(`An error occured: ${err.toString()}`);
			});
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
				text += "\n/queue    - Manage queue";
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
