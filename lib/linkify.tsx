import type { ReactNode } from "react";

/** 알림 본문에 적힌 주소를 클릭할 수 있는 링크로 바꿔 준다.
 *
 * 본문은 사람이 직접 쓴 평문이므로 HTML로 해석하지 않는다. 정규식으로 찾은 주소만
 * React 요소로 만들고 나머지는 문자열 그대로 두기 때문에, 본문에 태그를 적어도
 * 글자로만 보인다(dangerouslySetInnerHTML 을 쓰지 않는다).
 */

// 링크로 인정하는 건 http(s):// 로 시작하거나 www. 로 시작하는 것뿐이다.
// 괄호와 한글은 주소 바깥의 글자로 본다 — 한글은 조사로 바로 붙는 일이 많고
// ("...kr/notice에서"), 괄호는 주소를 감싸는 데 쓰인다("(https://...)").
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}ㄱ-ㆎ가-힣]+/gi;

// 주소 끝에 붙은 문장부호는 주소가 아니라 문장의 일부다.
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "·", "…", "'", '"', "”", "’"]);

function trimTrailingPunctuation(url: string) {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(url[end - 1])) end -= 1;
  return url.slice(0, end);
}

/** www. 로만 적은 주소에는 https:// 를 붙인다. 도메인 꼴이 아니면 링크로 만들지 않는다. */
function hrefFor(url: string) {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const host = href.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  return /^[^.]+(\.[^.]+)+$/.test(host) ? href : null;
}

/** 주소만 <a>로 바꾼 조각들을 돌려준다. 주소가 없으면 원문 문자열 하나만 들어 있다. */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;

  for (let match = URL_PATTERN.exec(text); match; match = URL_PATTERN.exec(text)) {
    const url = trimTrailingPunctuation(match[0]);
    const href = url ? hrefFor(url) : null;
    if (href) {
      if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
      nodes.push(
        <a key={`${match.index}-${url}`} href={href} target="_blank" rel="noopener noreferrer nofollow">
          {url}
        </a>,
      );
      lastIndex = match.index + url.length;
    }
    // 문장부호를 떼어 낸 만큼 되돌려, 그 뒤 글자부터 다시 찾는다.
    URL_PATTERN.lastIndex = Math.max(lastIndex, match.index + 1);
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
