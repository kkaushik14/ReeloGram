import type {Metadata} from "next";
import PasswordRecoveryForm from "@/app/components/PasswordRecoveryForm";
export const metadata:Metadata={title:"Set a new password — ReeloGram",referrer:"no-referrer",robots:{index:false,follow:false}};
export default function ResetPasswordPage(){return <PasswordRecoveryForm reset/>;}
