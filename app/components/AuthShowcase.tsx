"use client";
import {useEffect,useRef,useState} from "react";
import {Aperture,Pause,Play,ArrowUpRight} from "lucide-react";
import type {FeedVideo} from "./VideoFeed";
import VideoCredit from "./VideoCredit";

export default function AuthShowcase(){
 const [video,setVideo]=useState<FeedVideo|null>(null);const [desktop,setDesktop]=useState(false);const [paused,setPaused]=useState(false);const [blocked,setBlocked]=useState(false);const player=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const media=matchMedia('(min-width:801px)');const sync=()=>setDesktop(media.matches);sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
 useEffect(()=>{if(!desktop){setVideo(null);return;}const controller=new AbortController();fetch('/api/showcase',{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject()).then(data=>setVideo(data.videos.find((item:FeedVideo)=>item.source?.provider==="Pexels")??data.videos[0]??null)).catch(()=>{});return()=>controller.abort();},[desktop]);
 useEffect(()=>{const element=player.current;if(!element||!video||!desktop)return;let cancelled=false;const sync=()=>{if(!paused&&!document.hidden)element.play().then(()=>{if(!cancelled)setBlocked(false);}).catch(()=>{if(!cancelled)setBlocked(true);});else element.pause();};sync();document.addEventListener('visibilitychange',sync);return()=>{cancelled=true;element.pause();document.removeEventListener('visibilitychange',sync);};},[video,paused,desktop]);
 if(!desktop)return null;
 return <aside className="auth-showcase" aria-label="A look inside ReeloGram"><div className="showcase-decoration" aria-hidden="true"><span/><span/><span/></div><div className="showcase-frame"><div className="showcase-top"><span><Aperture size={20}/><strong>ReeloGram</strong></span><span>Reels</span></div><div className="showcase-screen">{video?<video ref={player} src={video.videoUrl} poster={video.thumbnailUrl} autoPlay muted loop playsInline preload="metadata" onError={()=>setBlocked(true)}/>:<div className="showcase-placeholder"/>}<span className="showcase-corner top-left" aria-hidden="true"/><span className="showcase-corner bottom-right" aria-hidden="true"/>{video&&<button className="showcase-toggle" aria-label={paused||blocked?"Play preview":"Pause preview"} onClick={()=>{if(blocked){setBlocked(false);setPaused(false);void player.current?.play().catch(()=>setBlocked(true));}else setPaused(value=>!value);}}>{paused||blocked?<Play size={18}/>:<Pause size={18}/>}</button>}</div><div className="showcase-caption">{video?<><h2>{video.title}</h2><VideoCredit video={video}/></>:<h2>A fresh perspective.</h2>}</div></div><a className="showcase-explore" href="/reels">Take a look around <ArrowUpRight size={18}/></a></aside>;
}
