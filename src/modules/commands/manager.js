// eslint-disable-next-line no-unused-vars
const { Collection, Client, Message, MessageEmbed } = require('discord.js');
// eslint-disable-next-line no-unused-vars
const Command = require('./command');

const fs = require('fs');
const { path } = require('../../utils/fs');

/**
 * Manages the loading and execution of commands
 */
module.exports = class CommandManager {
	/**
	 * Create a CommandManager instance
	 * @param {Client} client 
	 */
	constructor(client) {
		/** The Discord Client */
		this.client = client;

		/** A discord.js Collection (Map) of loaded commands */
		this.commands = new Collection();
	}

	/** Automatically load all internal commands */
	load() {
		const files = fs.readdirSync(path('./src/commands'))
			.filter(file => file.endsWith('.js'));

		for (let file of files) {
			try {
				file = require(`../../commands/${file}`);
				new file(this.client);
			} catch (e) {
				this.client.log.warn('An error occurred whilst loading an internal command');
				this.client.log.error(e);
			}
		}
	}

	/** Register a command */
	register(cmd) {
		const exists = this.commands.has(cmd.name);
		const is_internal = (exists && cmd.internal)
			|| (exists && this.commands.get(cmd.name).internal);

		if (is_internal) {
			let plugin = this.client.plugins.plugins.find(p => p.commands.includes(cmd.name));
			if (plugin)
				this.client.log.commands(`The "${plugin.name}" plugin has overridden the internal "${cmd.name}" command`);
			else
				this.client.log.commands(`An unknown plugin has overridden the internal "${cmd.name}" command`);	
			if(cmd.internal) return;
		}
		else if (exists)
			throw new Error(`A non-internal command with the name "${cmd.name}" already exists`);
		
		this.commands.set(cmd.name, cmd);

		let internal = cmd.internal ? 'internal ' : '';
		this.client.log.commands(`Loaded ${internal}"${cmd.name}" command`);
	}

	/**
	 * Execute a command
	 * @param {Message} message - Command message
	 */
	async handle(message) {
		let settings = await message.guild.settings;
		if (!settings) settings = await message.guild.createSettings();
		
		const prefix = settings.command_prefix;
		const i18n = this.client.i18n.get(settings.locale);

		let cmd_name = message.content.match(new RegExp(`^${prefix.replace(/(?=\W)/g, '\\')}(\\S+)`, 'mi'));
		if (!cmd_name) return;

		let raw_args = message.content.replace(cmd_name[0], '').trim(); // remove the prefix and command
		cmd_name = cmd_name[1]; // set cmd_name to the actual string

		const cmd = this.commands.find(cmd => cmd.aliases.includes(cmd_name));
		if (!cmd) return;

		let args = raw_args;

		const addArgs = (embed, arg) => {
			let required = arg.required ? '`???` ' : '';
			embed.addField(required + arg.name, `?? ${i18n('cmd_usage.args.description')} ${arg.description}\n?? ${i18n('cmd_usage.args.example')} \`${arg.example}\``);
		};

		if (cmd.process_args) {
			args = {};
			let data = [...raw_args.matchAll(/(?<key>\w+)\??\s?:\s?(?<value>([^;]|;{2})*);/gmi)];
			data.forEach(arg => args[arg.groups.key] = arg.groups.value.replace(/;{2}/gm, ';'));
			for (let arg of cmd.args) {
				if (arg.required && !args[arg]) {
					let usage = `${prefix + cmd_name} ${cmd.args.map(arg => arg.required ? `<${arg.name};>` : `[${arg.name};]`).join(' ')}`;
					let example = `${prefix + cmd_name} ${cmd.args.map(arg => `${arg.name}: ${arg.example};`).join(' ')}`;
					let embed = new MessageEmbed()
						.setColor(settings.error_colour)
						.setTitle(i18n('cmd_usage.title', cmd_name))
						.setDescription(i18n('cmd_usage.named_args') + i18n('cmd_usage.description', usage, example));
					cmd.args.forEach(a => addArgs(embed, a));
					return message.channel.send(embed);
				}
			}
		} else {
			const args_num = raw_args.split(' ').filter(arg => arg.length !== 0).length;
			const required_args = cmd.args.reduce((acc, arg) => arg.required ? acc + 1 : acc, 0);
			if (args_num < required_args) {
				let usage = `${prefix + cmd_name} ${cmd.args.map(arg => arg.required ? `<${arg.name}>` : `[${arg.name}]`).join(' ')}`;
				let example = `${prefix + cmd_name} ${cmd.args.map(arg => `${arg.example}`).join(' ')}`;
				let embed = new MessageEmbed()
					.setColor(settings.error_colour)
					.setTitle(i18n('cmd_usage.title', cmd_name))
					.setDescription(i18n('cmd_usage.description', usage, example));
				cmd.args.forEach(a => addArgs(embed, a));
				return message.channel.send(embed);
			}
		}

		const missing_perms = cmd.permissions instanceof Array && !message.member.hasPermission(cmd.permissions);
		if (missing_perms) {
			let perms = cmd.permissions.map(p => `\`${p}\``).join(', ');
			return await message.channel.send(
				new MessageEmbed()
					.setColor(settings.error_colour)
					.setTitle(i18n('missing_perms.title'))
					.setDescription(i18n('missing_perms.description', perms))
			);
		}

		if (cmd.staff_only) {
			let staff_roles = new Set();
			let guild_categories = await this.client.db.models.Category.findAll({
				where: {
					guild: message.guild.id
				}
			});
			guild_categories.forEach(cat => {
				cat.roles.forEach(r => staff_roles.add(r));
			});
			staff_roles = staff_roles.filter(r => message.member.roles.cache.has(r));
			const not_staff = staff_roles.length === 0;
			if (not_staff) {
				return await message.channel.send(
					new MessageEmbed()
						.setColor(settings.error_colour)
						.setTitle(i18n('staff_only.title'))
						.setDescription(i18n('staff_only.description'))
				);
			}
		}
			
		try {
			this.client.log.commands(`Executing "${cmd.name}" command (invoked by ${message.author.tag})`);
			await cmd.execute(message, args); // execute the command 
		} catch (e) {
			this.client.log.warn(`An error occurred whilst executing the ${cmd.name} command`);
			this.client.log.error(e);
			// await message.channel.send(i18n('command_execution_error'));
			await message.channel.send(
				new MessageEmbed()
					.setColor('ORANGE')
					.setTitle(i18n('command_execution_error.title'))
					.setDescription(i18n('command_execution_error.description'))
			);
		}
	}

};