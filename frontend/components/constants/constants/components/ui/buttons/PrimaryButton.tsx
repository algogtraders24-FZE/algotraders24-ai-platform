interface Props{

children:React.ReactNode

}

export default function PrimaryButton({children}:Props){

return(

<button

className="px-8 py-4 rounded-xl bg-blue-600 hover:bg-blue-700 transition font-semibold"

>

{children}

</button>

)

}