export const videoSources = {
 Pexels:{logo:"/brands/pexels.svg",color:"#05A081",url:"https://www.pexels.com/videos/"},
 Pixabay:{logo:"/brands/pixabay.svg",color:"#24342b",url:"https://pixabay.com/videos/"},
 Coverr:{logo:"/brands/coverr.png",color:"#fff",url:"https://coverr.co/stock-video-footage"},
 Mixkit:{logo:"/brands/mixkit.png",color:"#fff",url:"https://mixkit.co/free-stock-video/"},
} as const;
export type VideoSource = keyof typeof videoSources;
