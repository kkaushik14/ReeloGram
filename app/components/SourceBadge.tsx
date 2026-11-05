/* eslint-disable @next/next/no-img-element */
import {videoSources,type VideoSource} from "@/lib/video-sources";

export default function SourceBadge({provider}:{provider:VideoSource}){
 const source=videoSources[provider];
 return <a className="source-badge" href={source.url} target="_blank" rel="noopener noreferrer"><span className="source-badge-logo" style={{background:source.color}}><img src={source.logo} width="19" height="19" alt=""/></span><strong>{provider}</strong></a>;
}
