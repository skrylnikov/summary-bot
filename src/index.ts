import { env } from "node:process";
import { URL } from "node:url";

import { config } from "dotenv";
import { Bot } from "grammy";
import { fetch } from "undici";
import { PrismaClient } from "@prisma/client";

config();

const bot = new Bot(env.TG_TOKEN!);

const endpoint = "https://300.ya.ru/api/sharing-url";

const prisma = new PrismaClient();

bot.command(["start", "help"], (ctx) => {
  ctx.reply(`Бот для краткого пересказа статей. Работает на основе YandexGPT.
Просто отправь ссылку на статью и получи краткий пересказ.`);
});

bot.command("stats", async (ctx) => {
  const links = await prisma.link.findMany();
  const users = await prisma.user.findMany();

  ctx.reply(
    `Всего ссылок: ${links.length}
Всего пользователей: ${users.length}
Авторизованных пользователей: ${users.filter((x) => x.autorized).length}`
  );
});

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

    console.log(
      `Got url: ${firstUrl.href}, chat: ${ctx.message?.chat?.id}, user: ${ctx.from?.id} ${ctx.from?.username}`
    );

    await ctx.replyWithChatAction("typing");

    const [request, link] = await Promise.all([
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "OAuth " + env.YA_TOKEN,
        },
        body: JSON.stringify({
          article_url: firstUrl.href,
        }),
      }),
      prisma.link.create({
        data: {
          link: firstUrl.href,
          userId: ctx.from?.id?.toString()!,
          chatId: ctx.message?.chat?.id?.toString()!,
        },
      }),
      prisma.user.upsert({
        where: {
          id: ctx.from?.id?.toString(),
        },
        create: {
          id: ctx.from?.id?.toString()!,
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          lastName: ctx.from?.last_name,
          autorized: ctx.from?.id === ctx.message?.chat?.id,
        },
        update: {
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          lastName: ctx.from?.last_name,
          ...(ctx.from?.id === ctx.message?.chat?.id
            ? { autorized: true }
            : {}),
        },
      }),
    ]);

    const response = (await request.json()) as any;

    if (response.status !== "success") {
      return;
    }

    await prisma.link.update({
      where: {
        id: link.id,
      },
      data: {
        success: true,
      },
    });

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
