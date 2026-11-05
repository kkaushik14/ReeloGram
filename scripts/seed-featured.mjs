import assert from "node:assert/strict";
import {createRequire} from "node:module";
import mongoose from "mongoose";
import ImageKit from "imagekit";
import {featuredClips} from "./featured-clips.mjs";

// Never run on application startup. Explicitly opt in to writes to the configured services.
if (!process.argv.includes("--apply")) {
    console.log("Reviewed featured collection:");
    for (const clip of featuredClips) console.log(`${clip.title} — ${clip.creator}\n${clip.url}`);
    console.log("Import into the configured MongoDB and ImageKit: npm run seed:featured -- --apply");
    process.exit(0);
}
const require=createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd());
for(const key of ["REELOGRAM_MONGODB_URL","REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY","REELOGRAM_PRIVATE_KEY","REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT"]) assert.ok(process.env[key],`${key} must be configured`);
const imagekit=new ImageKit({publicKey:process.env.REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY,privateKey:process.env.REELOGRAM_PRIVATE_KEY,urlEndpoint:process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT});

async function verify(url, host, type, maxBytes){
    const parsed=new URL(url);
    assert.equal(parsed.protocol,"https:");assert.equal(parsed.hostname,host);assert.ok(["videos.pexels.com","images.pexels.com","cdn.pixabay.com","cdn.coverr.co","assets.mixkit.co"].includes(host),"Unreviewed media host");
    const response=await fetch(url,{method:host==="cdn.coverr.co"?"GET":"HEAD",redirect:"follow",signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok,"Source media is unavailable");
    assert.ok(response.headers.get("content-type")?.startsWith(type),"Unexpected source file type");
    const bytes=Number(response.headers.get("content-length"));
    await response.body?.cancel();
    assert.ok(bytes>0&&bytes<=maxBytes,"Source file exceeds the upload limit");
}
try{
    await mongoose.connect(process.env.REELOGRAM_MONGODB_URL,{serverSelectionTimeoutMS:10000});
    const videos=mongoose.connection.collection("videos");
    await videos.createIndex({"source.id":1},{unique:true,sparse:true});
    for(const clip of featuredClips){
        if(await videos.findOne({"source.id":clip.id})){console.log(`Already imported: ${clip.title}`);continue;}
        const thumbnail=clip.thumbnail;
        await Promise.all([verify(clip.file,new URL(clip.file).hostname,"video/mp4",100*1024*1024),verify(thumbnail,new URL(thumbnail).hostname,"image/",5*1024*1024)]);
        const created=[];
        try{
            const upload=async(file,name)=>{
                const result=await imagekit.upload({file,fileName:`${clip.id.replace(/:/g,"-")}-${name}`,folder:`/reelogram/${clip.provider.toLowerCase()}`,tags:[clip.provider.toLowerCase(),clip.id.replace(/:/g,"-")],useUniqueFileName:true,isPrivateFile:false});
                created.push(result.fileId);return result;
            };
            const video=await upload(clip.file,"video.mp4");
            const cover=await upload(thumbnail,"cover.jpg");
            const verifiedVideo=await imagekit.getFileDetails(video.fileId);
            const verifiedCover=await imagekit.getFileDetails(cover.fileId);
            assert.ok(verifiedVideo.mime?.startsWith("video/")&&["image/jpeg","image/png","image/webp","image/avif"].includes(verifiedCover.mime),`Uploaded media types must be verified by ImageKit (${clip.provider}: ${verifiedVideo.mime}, ${verifiedCover.mime})`);
            assert.ok(video.size>0&&video.size<=100*1024*1024&&cover.size<=5*1024*1024,"Uploaded files exceed limits");
            const now=new Date();
            // Editorial imports have no user owner. They never masquerade as a community upload.
            await videos.insertOne({title:clip.title,description:clip.description,videoUrl:video.url,thumbNailUrl:verifiedCover.mime==="image/avif"?`${cover.url}?tr=f-jpg`:cover.url,fileId:video.fileId,thumbnailFileId:cover.fileId,controls:true,deletionPending:false,placement:clip.placement??"feed",transformatioon:{width:video.width||clip.width,height:video.height||clip.height},source:{provider:clip.provider,id:clip.id,url:clip.url,creator:clip.creator,license:clip.license},createdAt:now,updatedAt:now});
            console.log(`Imported: ${clip.title} — ${clip.creator}`);
        }catch(error){
            for(const fileId of created){try{await imagekit.deleteFile(fileId);}catch{console.error(`Import cleanup needed for file ${fileId}`);}}
            throw error;
        }
    }
    console.log("Featured collection import complete. Re-running skips existing clips.");
}catch(error){
    // SDK errors can contain request configuration; never print those objects or credentials.
    console.error("Import failed:",error instanceof assert.AssertionError?error.message:error?.name??"Service error");
    process.exitCode=1;
}finally{await mongoose.disconnect();}
