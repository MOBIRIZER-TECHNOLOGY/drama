import { useEffect } from "react";
import type { VideoPlayerProps } from "../player/VideoPlayer";

/** Test double for the real player: exposes its props and buttons that fire each callback. */
export const player: { props: VideoPlayerProps | null } = { props: null };

export function VideoPlayer(props: VideoPlayerProps) {
  useEffect(() => {
    player.props = props;
  });
  return (
    <div data-testid="player" data-src={props.src ?? ""} data-embed={props.embedHtml ?? ""} data-poster={props.poster ?? ""} data-title={props.title}>
      <button onClick={props.onNext}>stub-next</button>
      <button onClick={props.onEnded}>stub-ended</button>
      <button onClick={() => props.onProgress(20.7, 100)}>stub-progress-mid</button>
      <button onClick={() => props.onProgress(99, 100)}>stub-progress-end</button>
      <button onClick={() => props.onProgress(5, null)}>stub-progress-unknown</button>
      <button onClick={props.onReload}>stub-reload</button>
      <button onClick={() => props.onAspectRatio?.(16 / 9)}>stub-landscape</button>
      <span data-testid="has-next">{String(props.hasNext)}</span>
      <span data-testid="sub-label">{props.subtitleLabel?.("hi")}|{props.subtitleLabel?.("xx")}</span>
    </div>
  );
}
