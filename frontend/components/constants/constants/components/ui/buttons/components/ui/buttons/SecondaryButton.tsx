interface Props{

children:React.ReactNode

}

export default function SecondaryButton({children}:Props){

return(

<button

className="px-8 py-4 rounded-xl border border-white/20 hover:border-blue-500 transition"

>

{children}

</button>

)

}