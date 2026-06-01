import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("movie")
    .setDescription("Search for a movie and get a VidKing link")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("Movie name")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName("tv")
    .setDescription("Search for a TV show and get a VidKing link")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("TV show name")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option
        .setName("season")
        .setDescription("Season number")
        .setRequired(false)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option
        .setName("episode")
        .setDescription("Episode number")
        .setRequired(false)
        .setMinValue(1)
    )
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registering slash commands...");

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("Slash commands registered.");
} catch (error) {
  console.error("Failed to register commands:", error);
}