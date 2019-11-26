function(properties, context) {
    //Load any data 

    let restrictions = {
            maxNumberOfFiles: 1,
            maxFileSize: parseInt(context.keys['MAX FILE SIZE']) || 5242880
    }
    if(context.keys['ALLOWED FILE TYPES']){
        restrictions.allowedFileTypes = context.keys['ALLOWED FILE TYPES'].split(" ")
    }
    
    Robodog.pick({
        target: 'body',
        restrictions: restrictions,
        params: {
            auth: { key: context.keys['AUTH KEY'] },
            template_id: context.keys['TEMPLATE ID']
        },
        waitForEncoding: true,
        providers: context.keys['ALLOWED SOURCES'] ? context.keys['ALLOWED SOURCES'].split(" ") : ['url', 'webcam', 'dropbox', 'google-drive', 'instagram']
    })
        .then((bundle) => {
            fetch(context.keys['NOTIFY URL'], {
                method: 'post',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bundle.transloadit)
            }).then(res => res.json())
                .then(res => console.log(res));

        })
}