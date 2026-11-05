"use client";
/* eslint-disable @next/next/no-img-element */
import {useEffect,useState} from "react";
import Link from "next/link";
import {ArrowUpRight,Pause,Play} from "lucide-react";
import Headline from "./motion/Headline";

const resources=[
 {name:"Pexels",url:"https://www.pexels.com/videos/",logo:"/brands/pexels.svg",color:"#05A081",background:"linear-gradient(115deg,#263e36,#647365)"},
 {name:"Pixabay",url:"https://pixabay.com/videos/",logo:"/brands/pixabay.svg",color:"#24342b",background:"linear-gradient(115deg,#253c37,#526d68)"},
 {name:"Coverr",url:"https://coverr.co/stock-video-footage",logo:"/brands/coverr.png",color:"#fff",background:"linear-gradient(115deg,#30364b,#666581)"},
 {name:"Mixkit",url:"https://mixkit.co/free-stock-video/",logo:"/brands/mixkit.png",color:"#fff",background:"linear-gradient(115deg,#41354a,#7c6573)"},
];

export default function ResourceHero(){
 const [index,setIndex]=useState(0);const [paused,setPaused]=useState(false);const [hovered,setHovered]=useState(false);const [focused,setFocused]=useState(false);const [reduced,setReduced]=useState(true);const [hidden,setHidden]=useState(false);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion:reduce)');const sync=()=>setReduced(media.matches);const visibility=()=>setHidden(document.hidden);sync();visibility();media.addEventListener('change',sync);document.addEventListener('visibilitychange',visibility);return()=>{media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',visibility);};},[]);
 useEffect(()=>{if(paused||hovered||focused||reduced||hidden)return;const timer=setInterval(()=>setIndex(value=>(value+1)%resources.length),7000);return()=>clearInterval(timer);},[paused,hovered,focused,reduced,hidden]);
 const resource=resources[index];
 return <section className={`resource-hero ${paused?"is-paused":""}`} aria-label="Discover free video resources" style={{background:resource.background}} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
  <div className="resource-select" aria-label="Choose a video resource">{resources.map((item,position)=><button key={item.name} type="button" aria-label={`Feature ${item.name}`} aria-pressed={position===index} onClick={()=>setIndex(position)}><span/></button>)}</div>
  <div className="resource-heading"><Headline text={"See something\nnew."}/><Link href="/reels" className="hero-cta">Explore Reels <ArrowUpRight size={21}/></Link></div>
  <span className="resource-orbit" aria-hidden="true"><span/></span>
  <div className="resource-feature" key={resource.name}><a href={resource.url} target="_blank" rel="noopener noreferrer" aria-label={`Explore free videos on ${resource.name} (opens in a new tab)`}><span className="resource-brand" style={{background:resource.color}}><img src={resource.logo} width="30" height="30" alt=""/></span><span>{resource.name}</span><ArrowUpRight size={20}/></a></div>
  <button type="button" className="resource-pause" aria-label={paused?"Resume resource slideshow":"Pause resource slideshow"} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button>
 </section>;
}
