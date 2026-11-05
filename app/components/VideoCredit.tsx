import type {FeedVideo} from "./VideoFeed";

export default function VideoCredit({video}:{video:FeedVideo}){
 if(!video.source)return null;
 return <a className="video-credit" href={video.source.url} target="_blank" rel="noopener noreferrer">Video by {video.source.creator}<span> on Pexels ↗</span></a>;
}
