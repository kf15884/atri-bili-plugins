"use strict";
const { Fault } = require("./api"),
  { buildMiniAppRequest, parseMiniAppResponse } = require("./miniapp");
async function onebot(bot, action, params, timeout = 20000) {
  const call = bot?.internal?._get || bot?.internal?._request;
  if (typeof call !== "function") throw new Fault("qq-raw-api-unavailable");
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => call.call(bot.internal, action, params)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Fault("qq-outcome-unknown")),
          timeout,
        );
      }),
    ]);
    if (result && typeof result === "object" && "retcode" in result) {
      if (Number(result.retcode) !== 0) throw new Fault("qq-api-rejected");
      return result.data;
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}
async function sendCard(
  bot,
  video,
  target,
  active = () => true,
  onSubmit = () => {},
) {
  if (
    !/^\d{5,15}$/.test(String(target)) ||
    !Number.isSafeInteger(Number(target))
  )
    throw new Fault("qq-target-invalid");
  if (!active()) throw new Fault("execution-paused");
  const response = await onebot(bot, "send_pb", buildMiniAppRequest(video));
  const card = parseMiniAppResponse(response);
  if (!active()) throw new Fault("execution-paused");
  onSubmit();
  const receipt = await onebot(bot, "send_private_msg", {
    user_id: Number(target),
    message: [{ type: "json", data: { data: JSON.stringify(card) } }],
  });
  if (!receipt || !/^-?\d{1,30}$/.test(String(receipt.message_id || "")))
    throw new Fault("qq-outcome-unknown");
  return String(receipt.message_id);
}
module.exports = { sendCard, onebot };
