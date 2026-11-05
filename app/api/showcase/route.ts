import {NextResponse} from "next/server";
import {connectToDatabase} from "@/lib/db";
import Video,{type InterFVideo} from "@/models/Video";
import {serializeVideo} from "@/lib/video-response";

export const dynamic="force-dynamic";
export async function GET(){
 try{
  await connectToDatabase();
  const records=await Video.find({placement:"hero",deletionPending:{$ne:true}}).sort({createdAt:-1}).limit(4).lean<InterFVideo[]>();
  return NextResponse.json({videos:records.map(record=>({...serializeVideo(record),videoUrl:`${record.videoUrl}?tr=w-960,h-540,c-at_max,q-50`}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"The video preview is temporarily unavailable"},{status:503});}
}
