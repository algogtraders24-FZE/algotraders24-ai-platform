interface Props{

title:string

subtitle:string

}

export default function PlatformCard({

title,

subtitle

}:Props){

return(

<div className="rounded-2xl border border-border bg-ink-2 p-8 hover:border-gold transition">

<h3 className="text-2xl font-bold">

{title}

</h3>

<p className="text-gold mt-3">

{subtitle}

</p>

</div>

)

}