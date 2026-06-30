interface Props{

title:string

subtitle:string

}

export default function PlatformCard({

title,

subtitle

}:Props){

return(

<div className="rounded-2xl border border-white/10 bg-white/5 p-8 hover:border-blue-500 transition">

<h3 className="text-2xl font-bold">

{title}

</h3>

<p className="text-blue-400 mt-3">

{subtitle}

</p>

</div>

)

}