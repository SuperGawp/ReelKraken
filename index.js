import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits
} from "discord.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const VIDKING_BASE_URL = "https://www.vidking.net/embed";

const userSearchCache = new Map();

function buildVidKingUrl(type, tmdbId, season = 1, episode = 1) {
  const params = new URLSearchParams({
    autoPlay: "true",
    color: "e50914",
    nextEpisode: "true",
    episodeSelector: "true"
  });

  if (type === "movie") {
    return `${VIDKING_BASE_URL}/movie/${tmdbId}?${params.toString()}`;
  }

  return `${VIDKING_BASE_URL}/tv/${tmdbId}/${season}/${episode}?${params.toString()}`;
}

async function searchTmdb(query, type) {
  const endpoint = type === "movie" ? "search/movie" : "search/tv";

  const url = new URL(`${TMDB_BASE_URL}/${endpoint}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  url.searchParams.set("page", "1");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TMDB request failed with status ${response.status}`);
  }

  const data = await response.json();

  return (data.results ?? [])
    .filter(item => {
      if (type === "movie") return item.title;
      return item.name;
    })
    .slice(0, 10);
}

function getTitle(result, type) {
  return type === "movie" ? result.title : result.name;
}

function getReleaseDate(result, type) {
  return type === "movie" ? result.release_date : result.first_air_date;
}

function buildResultEmbed({ result, type, index, total, season = 1, episode = 1 }) {
  const title = getTitle(result, type);
  const releaseDate = getReleaseDate(result, type);
  const year = releaseDate ? releaseDate.slice(0, 4) : "Unknown";
  const rating = result.vote_average ? result.vote_average.toFixed(1) : "N/A";
  const overview = result.overview || "No overview available.";
  const vidkingUrl = buildVidKingUrl(type, result.id, season, episode);

  const posterUrl = result.poster_path
    ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
    : null;

  const embed = new EmbedBuilder()
    .setTitle(`${title} (${year})`)
    .setDescription(
      overview.length > 700
        ? `${overview.slice(0, 697)}...`
        : overview
    )
    .addFields(
      {
        name: "Type",
        value: type === "movie" ? "Movie" : "TV Show",
        inline: true
      },
      {
        name: "TMDB ID",
        value: String(result.id),
        inline: true
      },
      {
        name: "Rating",
        value: String(rating),
        inline: true
      },
      {
        name: "Watch Link",
        value: `[Open in VidKing](${vidkingUrl})`
      }
    )
    .setURL(vidkingUrl)
    .setFooter({
      text: `Result ${index + 1} of ${total}`
    })
    .setTimestamp();

  if (posterUrl) {
    embed.setThumbnail(posterUrl);
  }

  if (type === "tv") {
    embed.addFields({
      name: "Episode",
      value: `Season ${season}, Episode ${episode}`,
      inline: true
    });
  }

  return embed;
}

function buildButtonRow(userId, currentIndex, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prev:${userId}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentIndex === 0),

    new ButtonBuilder()
      .setCustomId(`next:${userId}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentIndex >= total - 1)
  );
}

async function handleAutocomplete(interaction) {
  const focusedValue = interaction.options.getFocused();

  if (!focusedValue || focusedValue.length < 2) {
    await interaction.respond([]);
    return;
  }

  const type = interaction.commandName === "movie" ? "movie" : "tv";
  const results = await searchTmdb(focusedValue, type);

  const choices = results.map(result => {
    const title = getTitle(result, type);
    const releaseDate = getReleaseDate(result, type);
    const year = releaseDate ? releaseDate.slice(0, 4) : "Unknown";

    return {
      name: `${title} (${year})`.slice(0, 100),
      value: title.slice(0, 100)
    };
  });

  await interaction.respond(choices);
}

async function handleSearchCommand(interaction) {
  await interaction.deferReply();

  const type = interaction.commandName === "movie" ? "movie" : "tv";
  const query = interaction.options.getString("query");
  const season = interaction.options.getInteger("season") ?? 1;
  const episode = interaction.options.getInteger("episode") ?? 1;

  const results = await searchTmdb(query, type);

  if (results.length === 0) {
    await interaction.editReply(`No results found for **${query}**.`);
    return;
  }

  const searchState = {
    userId: interaction.user.id,
    type,
    query,
    results,
    currentIndex: 0,
    season,
    episode
  };

  userSearchCache.set(interaction.user.id, searchState);

  const embed = buildResultEmbed({
    result: results[0],
    type,
    index: 0,
    total: results.length,
    season,
    episode
  });

  const row = buildButtonRow(interaction.user.id, 0, results.length);

  await interaction.editReply({
    embeds: [embed],
    components: [row]
  });
}

async function handleButton(interaction) {
  const [action, ownerId] = interaction.customId.split(":");

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Only the person who searched can use these buttons.",
      ephemeral: true
    });
    return;
  }

  const searchState = userSearchCache.get(ownerId);

  if (!searchState) {
    await interaction.reply({
      content: "This search has expired. Run the command again.",
      ephemeral: true
    });
    return;
  }

  if (action === "next") {
    searchState.currentIndex = Math.min(
      searchState.currentIndex + 1,
      searchState.results.length - 1
    );
  }

  if (action === "prev") {
    searchState.currentIndex = Math.max(searchState.currentIndex - 1, 0);
  }

  userSearchCache.set(ownerId, searchState);

  const currentResult = searchState.results[searchState.currentIndex];

  const embed = buildResultEmbed({
    result: currentResult,
    type: searchState.type,
    index: searchState.currentIndex,
    total: searchState.results.length,
    season: searchState.season,
    episode: searchState.episode
  });

  const row = buildButtonRow(
    ownerId,
    searchState.currentIndex,
    searchState.results.length
  );

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "movie" || interaction.commandName === "tv") {
        await handleSearchCommand(interaction);
      }

      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: "Something went wrong while processing that request.",
        embeds: [],
        components: []
      });
    } else {
      await interaction.reply({
        content: "Something went wrong while processing that request.",
        ephemeral: true
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);