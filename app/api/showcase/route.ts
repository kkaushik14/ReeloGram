import {NextResponse} from "next/server";
import {connectToDatabase} from "@/lib/db";
import Video,{type InterFVideo} from "@/models/Video";
import {serializeVideo} from "@/lib/video-response";
import {limitRequest,rateLimitResponse} from "@/lib/security/rate-limit";

export const dynamic="force-dynamic";
export async function GET(req:Request){
 try{
  await limitRequest("showcase",null,req.headers);
  await connectToDatabase();
  const records=await Video.find({placement:"hero",deletionPending:{$ne:true}}).sort({createdAt:-1}).limit(4).lean<InterFVideo[]>();
  return NextResponse.json({videos:records.map(serializeVideo)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return rateLimitResponse(error) ?? NextResponse.json({error:"The video preview is temporarily unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
