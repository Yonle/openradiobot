const openradio = require("openradio");
const slimbot = require("slimbot");
const { Server } = require("http");
const miniget = require("miniget");
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
		let id = Math.random();
		res.setHeader("content-type", "audio/mp3");
		radios.get(id).metadata.listener.set(id, res);
		radios.get(id).metadata.totalListener++;

		req.on('close', () => {
			if (!radios.get(id)) return;
			radios.get(id).metadata.listener.delete(id);
		});
	}
});

// Used for Validating URL
function validateURL(str) {

  let pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol

    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name

    '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address

    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path

    '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string

    '(\\#[-a-z\\d_]*)?$','i'); // fragment locator

  return !!pattern.test(str);

}

bot.on("message", message => {
	message.chat.id = message.chat.id.toString();
	message.reply = async (text, replyToId) => {
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
	if (!message.text || !message.text.startsWith("/") || message.text.length < 3) return;
	let radio = radios.get(message.chat.id);
	switch (message.text.split(" ")[0].slice(1)) {
		case "new": 
			if (radio) return message.reply("You already created your radio. To manage it, Type /manage. To destroy it, Type /destroy");
			radios.set(message.chat.id, {
				player: new openradio().on('error', (err) => message.reply(err.toString())),
				queue: [],
				metadata: {
					listener: new Map(),
					totalListener: 0,
					starttime: Date.now(),
					curSong: null,
					autoplay: false,
					loopType: "none"
				},
				play: function () {
					if (!radio) radio = radios.get(message.chat.id);
					if (!radio) return console.log("There's no radio. Aborting...");
					radio.queue = radio.queue.filter(song => song);
					if (radio.metadata.loopType == "queue" && typeof(radio.metadata.curSong) === "object") radio.queue.push(radio.metadata.curSong);
					if (radio.metadata.loopType == "single" && typeof(radio.metadata.curSong) === "object") radio.queue.unshift(radio.metadata.curSong);
					let nextSong = radio.queue.shift();
					radio.metadata.curSong = null;
					if (!nextSong) return false;
					bot.sendChatAction(message.chat.id, 'typing');
					if (nextSong.type === "raw") {
						let stream = miniget(nextSong.url);
						stream.on('response', () => {
							radio.player.play(stream).then(radio.play);
							if (nextSong.isAttachment) {
								radio.metadata.curSong = nextSong;
								return message.reply(`▶️Playing Voice/Audio Message....`);
							}
							radio.metadata.curSong = nextSong;
							message.reply(`▶️Now Playing: [Raw Stream](${nextSong.url})`);
						});

						stream.on('request', () => {
							bot.sendChatAction(message.chat.id, 'typing');
						});

						stream.on('error', (err) => message.reply(err.toString()));
					} else {
					
						bot.sendChatAction(message.chat.id, 'typing');
						let stream = ytdl(nextSong.id || nextSong.videoDetails.videoId, { filter: "audioonly", quality: "highestaudio" });

						stream.on('info', (info) => {
							bot.sendChatAction(message.chat.id, 'typing');
							radio.metadata.curSong = info;
							radio.player.play(stream).then(radio.play);
							if (radio.metadata.autoplay) {
								radio.queue.push(info.related_videos[0]);
							}
							message.reply(`▶️Now playing: [${radio.metadata.curSong.videoDetails.title}](${radio.metadata.curSong.video_url})`);
						});

						stream.on('error', err => message.reply(err.toString()));
					}
					return true;
				}
			});
			radios.get(message.chat.id).player.on('data', data => radios.get(message.chat.id).listener.forEach((res, id) => res.write(data, err => {
					if (err) radios.get(message.chat.id).listener.delete(id);
			})));
			message.reply("✔️Radio Created");
			break;
		case "destroy": 
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			radio.player.destroy();
			radios.delete(message.chat.id);
			message.reply("✔️Radio destroyed.");
			break;
		case "manage": 
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			(() => {
				let text = "*Your radio status*";
				text += `\nListener: \`${radio.metadata.listener}\``;
				text += `\nTotal Listener: \`${radio.metadata.totalListener}\``;
				text += `\nLoop Type: \`${radio.metadata.loopType}\``;
				text += `\nCreated Since: \`${ms(Date.now() - radio.metadata.starttime)}\``;
				if (radio.metadata.curSong && !radio.metadata.curSong.isAttachment) text += 
				`\nNow Playing: [${radio.metadata.curSong.title||radio.metadata.curSong.videoDetails.title}](${radio.metadata.curSong.url || radio.metadata.curSong.videoDetails.video_url})`;
				if (radio.metadata.curSong && radio.metadata.curSong.isAttachment) text += "\nNow Playing: Voice/Audio Message";
				text += `\nAutoplay Enabled?: \`${radio.metadata.autoplay ? "Yes" : "No"}\``;
				text += `\nTotal Queue: \`${radio.queue.length}\``;
				text += `\nLive on: [${process.env.SERVER_HOST||"http://localhost:3000"}/${message.chat.id}](http://localhost:3000/${message.chat.id})`;
				text += `\n\nTo check song queue, Type /queue`;
				message.reply(text);
			})();
			break;
		case "queue":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.queue.length) return message.reply("🏜️Nothing is in queue....");
			let method = message.text.split(" ").slice(1)[0];
			if (!method) return (() => {
				let text = "*Radio Queue*";
				radio.queue.slice(0, 20).forEach((song, songNum) => {
					songNum++;
					if (song.isAttachment) {
						text += `\n${songNum}. Voice/Audio Message`;
					} else if (song.type === 'raw'){
						text += `\n${songNum}. [Raw Stream](${song.url})`;
					} else {
						text += `\n${songNum}. [${song.title}](https://youtu.be/${song.id})`;
					}
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
				if (!radio.queue[Number(args)-1]) return message.reply("No song was found in Queue Order number " + args);
				delete radio.queue[Number(args)-1];
				// Re-create. Ignore the undefined ones
				radio.queue = radio.queue.filter(song => song);
				message.reply(`✔️Song number ${args} has been removed.`);
			} else if (method === "move") {
				let args = message.text.split(" ").slice(2)[0];
				let to = message.text.split(" ").slice(3)[0];
				if (!args || !to) return message.reply("Usage: `/queue move [Order number] [To Order number]`");
				if (!radio.queue[Number(args)-1] || !radio.queue[Number(to)-1]) return message.reply("Song not found or invalid value.");
				let fromOrder = radio.queue[Number(args)-1];
				let toOrder = radio.queue[Number(to)-1];
				radio.queue[Number(args)-1] = toOrder;
				radio.queue[Number(to)-1] = fromOrder;
				message.reply(`✔️*${fromOrder.title}* order moved to *${toOrder.title}* order.`);
			} else if (method === "shuffle" || method === "random") {
				radio.queue.sort(() => 0.5 - Math.random());
				message.reply("✔️Queue order has been sorted randomly.");
			}
			break;
		case "play":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let str = message.text.split(" ").slice(1).join(" ");
			let audio = message.reply_to_message ? message.reply_to_message.audio||message.reply_to_message.voice||message.reply_to_message.document : null;
			if (!str.length && !audio) return message.reply("Usage: `/play [Song name|URL|Reply to Audio/Voice Message]`");
			if (str) message.reply(`Searching \`${str}\`...`);
			bot.sendChatAction(message.chat.id, 'typing');

			if (audio) {
				if (audio.type && !audio.type.startsWith("audio")) return message.reply("Unsupported Formats");
				let id = audio.file_id;
				bot.getFile(id).then(({ result }) => {
					let newQueue = {
						type: "raw",
						isAttachment: true,
						title: "Replied Audio",
						id: message.chat.id,
						messageID: message.id,
						url: `https://api.telegram.org/file/bot${bot._token}/${result.file_path}`
					}
					
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(newQueue);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.chat.id, 'typing');
						radio.play();
					} else {
						radio.queue.push(newQueue);
						message.reply("✔️Voice has been added to queue");
					}
				});
			} else if (str.toLowerCase().includes("youtube.com/playlist?list=")) {
				ytpl(str, { limit: Infinity, page: Infinity }).then(res => {
					if (!res.items.length) return message.reply("🙅No Result.");
					if (!radio) return;
					message.reply(`✔️${res.items.length} Song has been added to queue`);
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(res.items);
						radio.queue = radio.queue.flat(Infinity);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.chat.id, 'typing');
						radio.play();
					} else {
						radio.queue.push(res.items);
						radio.queue = radio.queue.flat(Infinity);
					}
				});
			} else if (validateURL(str) && !ytdl.validateURL(str)) {
				let newQueue = {
					type: 'raw',
					title: `Raw Stream`,
					url: str
				}
				if (!radio.queue.length && !radio.metadata.curSong) {
					radio.queue.push(newQueue);
					message.reply("Preparing to play...");
					bot.sendChatAction(message.chat.id, 'typing');
					radio.play();
				} else {
					radio.queue.push(newQueue);
					bot.sendChatAction(message.chat.id, 'typing');
					message.reply("✔️A stream URL has been added to queue.");
				}
			} else if (ytdl.validateURL(str)) {
				ytdl.getInfo(str).then(info => {
					info.formats = info.formats.filter(format => !format.hasVideo && format.hasAudio);
					if (!info.formats.length) return message.reply("❌Sorry. We can't Play this video due to our server region lock.");
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(info);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.chat.id, 'typing');
						radio.play();
					} else {
						radio.queue.push(info);
						message.reply(`✔️[${info.videoDetails.title}](${info.videoDetails.video_url}) has been added to queue.`);
					}
				});
			} else {
				ytsr(str, { limit: 1 }).then(res => {
					bot.sendChatAction(message.chat.id, 'typing');
					res.items = res.items.filter(video => video.type == "video");
					if (!res.items.length) return message.reply("🙅No Result.");
					if (!radio) return;
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(res.items[0]);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.chat.id, 'typing');
						radio.play();
					} else {
						radio.queue.push(res.items[0]);
						message.reply(`✔️[${res.items[0].title}](https://youtu.be/${res.items[0].id}) has been added to queue.`);
					}
				}).catch(err => {
					message.reply(`An error occured: ${err.toString()}`);
				});
			}
			break;
		case "pause":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			radio.player.pause();
			message.reply("⏸️Paused");
			break;
		case "resume":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			radio.player.resume();
			message.reply("▶️Resumed");
			break;
		case "skip":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			if (!radio.queue.length) return message.reply("There's nothing in queue!");
			radio.play();
			message.reply("⏩Skipping...");
			break;
		case "stop":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			radio.player.stream.destroy();
			radio.queue = [];
			message.reply("⏹️Player Stopped");
			break;
		case "autoplay":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let autoplay = radio.metadata.autoplay;
			if (radio.curSong.type == 'raw') return message.reply('Sorry. You can\'t use autoplay right now.');
			if (!autoplay) {
				radio.metadata.autoplay = true;
				let info = radio.metadata.curSong;
				radio.queue.push(info.related_videos[0]);
				message.reply("✔️Autoplay enabled");
			} else {
				radio.metadata.autoplay = false;
				message.reply("✔️Autoplay disabled");
			}
			break;
		case "loop":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			(() => {
				let loopType = message.text.split(" ").slice(1)[0];
				let availableLoopType = ["queue", "single", "none"];
				if (!loopType || !availableLoopType.includes(loopType)) return message.reply("Usage: `/loop [queue|single|none]`");
			
				radio.metadata.loopType = loopType.toLowerCase();
				message.reply(`✔️Loop Type has been set as \`${loopType.toLowerCase()}\``);
			})();
			break;
		default:
			if (!message.text.startsWith("/start") || !message.text.startsWith("/help")) return;
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
