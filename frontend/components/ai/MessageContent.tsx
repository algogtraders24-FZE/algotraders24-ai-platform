// components/ai/MessageContent.tsx
// Quant Chat "Ask AI Anything" - splits a message's raw text
// (lib/chat/parse-code-blocks.ts) into text/code segments and renders each
// fenced block as a real CodeBlock. Plain text segments keep the exact same
// whitespace-pre-wrap rendering MessageBubble already used for every
// message before this - a reply with no code fence in it renders
// byte-identical to before.
import { parseMessageSegments } from "@/lib/chat/parse-code-blocks";
import CodeBlock from "./CodeBlock";

interface Props {
  content: string;
}

export default function MessageContent({ content }: Props) {
  const segments = parseMessageSegments(content);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "code" ? (
          <CodeBlock key={i} language={segment.language} code={segment.code} />
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {segment.content}
          </span>
        ),
      )}
    </>
  );
}
