import { env } from "node:process";
import { URL } from "node:url";

import { config } from "dotenv";
import { Bot } from "grammy";
import { fetch } from "undici";

config();

const bot = new Bot(env.TG_TOKEN!);

const endpoint = "https://300.ya.ru/api/sharing-url";

bot.on("::url", async (ctx) => {
  try {
    const entitiesUrlList =
      ctx.message?.entities?.filter(
        (x) => x.type === "url" || x.type === "text_link"
      ) || [];

    const urlList = entitiesUrlList
      .map((x) => {
        let url =
          x.type === "text_link"
            ? x.url
            : ctx.message?.text?.slice(x.offset, x.offset + x.length);

        if (!url?.startsWith("http://") && !url?.startsWith("https://")) {
          url = `https://${url}`;
        }

        return new URL(url);
      })
      .filter((x) => x.pathname.length > 1);

    const firstUrl = urlList[0];

    if (!firstUrl) {
      return;
    }

    await ctx.replyWithChatAction("typing");

    const request = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "OAuth " + env.YA_TOKEN,
      },
      body: JSON.stringify({
        article_url: firstUrl.href,
      }),
    });

    const response = (await request.json()) as any;

    if (response.status !== "success") {
      return;
    }

    const htmlRequest = await fetch(response.sharing_url);

    const html = await htmlRequest.text();

    const data = html
      .split("\n")
      .find((x) => x.includes("data-sveltekit-fetched"))
      ?.split(">")[1]
      .split("<")[0];

    const json = JSON.parse(JSON.parse(data!).body);

    ctx.reply(
      "<b>Краткий пересказ: " +
        json.title +
        "</b>\n\n" +
        json.thesis.map((x: any) => "• " + x.content).join("\n"),
      { parse_mode: "HTML", reply_to_message_id: ctx.message?.message_id }
    );
  } catch (e) {
    console.error(e);
  }
});

bot.start();
