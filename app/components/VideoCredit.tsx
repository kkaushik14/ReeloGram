import type {FeedVideo} from "./VideoFeed";

export default function VideoCredit({video}:{video:FeedVideo}){
 if(!video.source)return null;
 if(video.source.creator===video.source.provider)return <a className="video-credit" href={video.source.url} target="_blank" rel="noopener noreferrer">Video from <strong>{video.source.provider}</strong> ↗</a>;
 return <a className="video-credit" href={video.source.url} target="_blank" rel="noopener noreferrer">Video by <strong>{video.source.creator}</strong><span> on <strong>{video.source.provider}</strong> ↗</span></a>;
}
