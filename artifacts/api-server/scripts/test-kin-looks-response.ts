import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";

import {
  buildUserMessage,
  buildKinLooksResult,
  normalizeAnthropicResponse,
  responseLanguageForQuery,
  webSearchToolErrorCodes,
} from "../src/lib/kin-search.ts";
import { isSuitableProductPreviewImage } from "../src/lib/link-preview.ts";

const verifiedResult = {
  title: "Verified beige chinos",
  source: "example.com",
  url: "https://example.com/chinos",
  price: null,
  currency: null,
  imageUrl: null,
};

const completeAnswer = [
  "###SIGNATURE###",
  "Beige chinos, a white Oxford shirt, an olive overshirt, and brown leather loafers make a balanced dinner outfit.",
  "MISSING: beige chinos, white Oxford shirt, olive overshirt, brown leather loafers",
  "###SAFE###",
  "Wear stone chinos with a white knit polo, an olive jacket, and clean white leather trainers for an easy smart-casual option.",
  "MISSING: stone chinos, white knit polo, olive jacket, white leather trainers",
  "###BOLD###",
  "Pair olive tailored trousers with a textured ivory shirt, a beige blazer, and dark-brown suede derbies for stronger contrast.",
  "MISSING: olive trousers, ivory shirt, beige blazer, suede derbies",
].join("\n");

const normalized = (answer: string, withResults = true) => ({
  answer,
  citations: [],
  results: withResults ? [verifiedResult] : [],
});

{
  const englishRequest = "Suggest a smart-casual men’s outfit for dinner in London at 15°C. I prefer beige, white, and olive. My total budget is £150. Include matching shoes.";
  assert.equal(responseLanguageForQuery(englishRequest), "English");
  assert.match(buildUserMessage({ mode: "looks", query: englishRequest }), /Required response language: English/);
  assert.equal(responseLanguageForQuery("اقترح إطلالة مناسبة للعشاء"), "Arabic");
}

{
  assert.equal(
    isSuitableProductPreviewImage("https://shop.example/social-logo.png", "Example Store logo", "Olive overshirt"),
    false,
  );
  assert.equal(
    isSuitableProductPreviewImage("https://shop.example/social-preview.jpg", null, "Olive overshirt"),
    false,
  );
  assert.equal(
    isSuitableProductPreviewImage("https://shop.example/products/olive-overshirt.jpg", "Men's olive cotton overshirt", "Olive cotton overshirt"),
    true,
  );
}

{
  const providerResponse = {
    content: [
      {
        type: "web_search_tool_result",
        content: [{
          type: "web_search_result",
          title: verifiedResult.title,
          url: verifiedResult.url,
        }],
      },
      {
        type: "web_search_tool_result",
        content: {
          type: "web_search_tool_result_error",
          error_code: "max_uses_exceeded",
        },
      },
      {
        type: "text",
        text: "I could not complete the outfit because no more searches are available.",
        citations: [],
      },
    ],
  } as unknown as Anthropic.Message;
  const toolErrors = webSearchToolErrorCodes(providerResponse);
  const result = buildKinLooksResult(
    normalizeAnthropicResponse(providerResponse),
    toolErrors,
  );
  assert.deepEqual(toolErrors, ["max_uses_exceeded"]);
  assert.equal(result.status, "partial");
  assert.equal(result.results.length, 1, "verified results must survive an incomplete response");
}

{
  const result = buildKinLooksResult(normalized(completeAnswer), ["max_uses_exceeded"]);
  assert.equal(result.status, "ok", "a denied extra search must not discard a complete recommendation");
  assert.equal(result.options.length, 3);
}

for (const malformed of [
  "",
  "###SIGNATURE###\nToo short",
  "###SIGNATURE###\nA sufficiently long signature option.\n###SAFE###\nA sufficiently long safe option.",
  "###SIGNATURE###\n\n###SAFE###\nA sufficiently long safe option.\n###BOLD###\nA sufficiently long bold option.",
]) {
  assert.equal(buildKinLooksResult(normalized(malformed, false), []).status, "partial");
}

{
  const result = buildKinLooksResult(normalized(completeAnswer), []);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.options.map((option) => option.label), ["signature", "safe", "bold"]);
}

console.log("KIN Looks response contract: all focused cases passed");